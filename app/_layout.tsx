import { ICloudGate } from "@/components/ICloudGate";
import { NotificationTray } from "@/components/NotificationTray";
import { useAutoSync } from "@/hooks/useAutoSync";
import { useNotificationResponse, useNotifications } from "@/hooks/useNotifications";
import { initializeBackgroundTasks } from "@/lib/backgroundTasks";
import { detectCSVProvider } from "@/lib/csvDetector";
import { addBreadcrumb, captureException, captureMessage, ErrorBoundary, initSentry } from "@/lib/sentry";
import { useSessionStore } from "@/store/useSessionStore";
import * as FileSystem from 'expo-file-system/legacy';
import { useFonts } from "expo-font";
import * as Linking from 'expo-linking';
import { SplashScreen, Stack, useRouter, useSegments } from "expo-router";
import { useEffect, useRef } from "react";
import { Alert, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import './globals.css';

// Initialize Sentry before app renders
initSentry();

// Stable navigator option references (inline objects re-render the navigator
// and React Navigation's internal PreventRemoveProvider on every render).
const STACK_SCREEN_OPTIONS = { headerShown: false } as const;
const TABS_STACK_OPTIONS = { gestureEnabled: false } as const;

// Global unhandled promise rejection handler
if (typeof global !== 'undefined') {
  const originalHandler = global.Promise;
  if (originalHandler) {
    const rejectionTracking = require('promise/setimmediate/rejection-tracking');
    rejectionTracking.enable({
      allRejections: true,
      onUnhandled: (id: string, error: Error) => {
        captureException(error, {
          tags: { error_type: 'unhandled_promise_rejection' },
          contexts: { promise_rejection: { id } }
        });
      },
      onHandled: () => {},
    });
  }
}

// Fallback error UI component
function ErrorFallback({ error, resetError }: { error: Error; resetError: () => void }) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: '#fff' }}>
      <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 10, color: '#1F2937' }}>Something went wrong</Text>
      <Text style={{ fontSize: 14, color: '#6B7280', marginBottom: 20, textAlign: 'center' }}>
        {error?.message || 'An unexpected error occurred'}
      </Text>
      <Text
        onPress={resetError}
        style={{ fontSize: 16, color: '#7C3AED', fontWeight: '600' }}
      >
        Try again
      </Text>
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, error] = useFonts({
    "QuickSand-Bold": require("../assets/fonts/Quicksand-Bold.ttf"),
    "QuickSand-Regular": require("../assets/fonts/Quicksand-Regular.ttf"),
    "QuickSand-Medium": require("../assets/fonts/Quicksand-Medium.ttf"),
    "QuickSand-SemiBold": require("../assets/fonts/Quicksand-SemiBold.ttf"),
    "QuickSand-Light": require("../assets/fonts/Quicksand-Light.ttf"),
  });

  const { checkSession, status, needsOnboarding } = useSessionStore();
  const router = useRouter();
  const segments = useSegments();
  const navigationAttempted = useRef(false);
  // Track pending password reset to handle after initial navigation
  const pendingPasswordReset = useRef<{ userId: string; secret: string } | null>(null);

  // Enable auto-sync
  useAutoSync();

  // Enable notifications
  useNotifications();
  useNotificationResponse();

  // Initialize background tasks
  useEffect(() => {
    const initBackground = async () => {
      try {
        await initializeBackgroundTasks();
        console.log('Background tasks initialized');
      } catch (error) {
        console.error('Failed to initialize background tasks:', error);
        captureException(error instanceof Error ? error : new Error(String(error)));
      }
    };
    
    initBackground();
  }, []);

  // Handle deep links for password reset and CSV file imports
  useEffect(() => {
    const handleDeepLink = async (event: { url: string }) => {
      const { hostname, path, queryParams } = Linking.parse(event.url);
      
      // Handle budgetapp://reset-password?userId=...&secret=...
      if (hostname === 'reset-password' || path === 'reset-password') {
        const userId = queryParams?.userId as string;
        const secret = queryParams?.secret as string;
        
        if (userId && secret) {
          // Store the reset params - we'll navigate after auth status is known
          pendingPasswordReset.current = { userId, secret };
          
          // If we already know auth status, navigate immediately
          if (status !== 'loading' && status !== 'idle') {
            router.push({
              pathname: '/auth/reset-password',
              params: { userId, secret }
            } as any);
            pendingPasswordReset.current = null;
          }
        }
        return;
      }

      // Handle file:// URLs (CSV or PDF files shared to the app)
      if (event.url.startsWith('file://')) {
        const fileExtension = event.url.split('.').pop()?.toLowerCase()?.split('?')[0] || '';
        
        // Handle PDF files — route directly to PDF import with the file URI
        if (fileExtension === 'pdf') {
          console.log('PDF import: Handling file URL:', event.url);
          try {
            Alert.alert(
              'PDF Statement Detected',
              'Import transactions from this PDF bank statement?',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Import',
                  isPreferred: true,
                  onPress: () => {
                    router.push({
                      pathname: '/import/pdf/pick',
                      params: { sharedFileUri: event.url }
                    } as any);
                  }
                },
              ]
            );
          } catch (error) {
            console.error('Error handling PDF file:', error);
            captureException(error as Error, {
              contexts: { pdf_import: { fileUrl: event.url } },
              tags: { feature: 'pdf_import', event_type: 'file_handle_error' }
            });
            Alert.alert('Error', 'Failed to open the PDF file.');
          }
          return;
        }
        
        console.log('CSV import: Handling file URL:', event.url);
        // CSV import handler invoked - no need to log to Sentry
        
        try {
          // On iOS, reading a file shared via "Open in" requires copying to app sandbox
          // Using legacy API from expo-file-system/legacy which is stable
          const cacheDir = FileSystem.cacheDirectory + 'csv_imports/';
          
          // Ensure cache directory exists
          try {
            await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });
          } catch (e) {
            // Ignore if directory already exists
            console.log('Cache directory exists or creation skipped');
          }

          const tempPath = `${cacheDir}${Date.now()}.csv`;
          console.log('CSV import: Temp path prepared:', tempPath);

          // Try multiple methods to read the file
          let fileContent: string | null = null;
          let readMethod = 'unknown';
          
          // Method 1: Try direct read (works for files in app sandbox or Inbox)
          try {
            console.log('CSV import: Method 1 - Attempting direct read from source');
            fileContent = await FileSystem.readAsStringAsync(event.url);
            readMethod = 'direct_read';
            // Direct read succeeded - no need to log to Sentry
          } catch (directReadError) {
            console.warn('CSV import: Direct read failed:', directReadError);
            
            // Method 2: Try copy then read (works for some shared files)
            try {
              console.log('CSV import: Method 2 - Attempting copy to cache');
              await FileSystem.copyAsync({
                from: event.url,
                to: tempPath
              });
              captureMessage('CSV import: File copied to cache', {
                level: 'info',
                contexts: { csv_import: { fileUrl: event.url, tempPath } },
                tags: { feature: 'csv_import', event_type: 'file_copied' }
              });
              console.log('CSV import: Reading file from cache...');
              fileContent = await FileSystem.readAsStringAsync(tempPath);
              readMethod = 'copy_then_read';
            } catch (copyError) {
              console.warn('CSV import: Copy failed:', copyError);
              
              // Method 3: Try reading with different encoding options
              try {
                console.log('CSV import: Method 3 - Attempting read with base64 encoding');
                const base64Content = await FileSystem.readAsStringAsync(event.url, {
                  encoding: FileSystem.EncodingType.Base64
                });
                // Decode base64 to string
                fileContent = atob(base64Content);
                readMethod = 'base64_decode';
              } catch (base64Error) {
                console.error('CSV import: All read methods failed');
                captureException(copyError instanceof Error ? copyError : new Error(String(copyError)), {
                  contexts: { 
                    csv_import: { 
                      fileUrl: event.url, 
                      tempPath,
                      directReadError: String(directReadError),
                      base64Error: String(base64Error)
                    } 
                  },
                  tags: { feature: 'csv_import', event_type: 'all_methods_failed' }
                });
                
                // Show helpful error with workaround suggestion
                Alert.alert(
                  'Unable to Read File',
                  'This file cannot be read directly. Please try one of these options:\n\n' +
                  '1. Open the CSV in Files app, tap Share, then select Loaded\n\n' +
                  '2. Use the "Import from Files" button in the app instead',
                  [{ text: 'OK' }]
                );
                return;
              }
            }
          }

          if (!fileContent) {
            Alert.alert('Error', 'No data found in the shared file');
            return;
          }
          
          console.log('CSV import: File read successful via', readMethod, 'length:', fileContent?.length);
          
          if (!fileContent || fileContent.trim().length === 0) {
            captureMessage('CSV import: Empty file detected', {
              level: 'warning',
              contexts: {
                csv_import: {
                  fileUrl: event.url,
                  tempPath,
                  fileSize: fileContent?.length || 0
                }
              },
              tags: {
                feature: 'csv_import',
                event_type: 'empty_file'
              }
            });
            Alert.alert('Error', 'The file appears to be empty');
            return;
          }

          // Detect the CSV provider (AIB or Revolut)
          const provider = detectCSVProvider(fileContent);

          // Build the title based on detected type
          const providerName = 
            provider === 'aib' ? 'AIB' :
            provider === 'revolut' ? 'Revolut' :
            provider === 'generic' ? 'Generic CSV' :
            'Unknown';
          
          const title = provider !== 'unknown' 
            ? `${providerName} Type File Detected` 
            : 'CSV File Detected';
          
          const message = provider !== 'unknown'
            ? `Click OK to proceed with ${providerName} import`
            : 'Click OK to proceed or choose a different import type';
          
          // Show single popup with OK and Change Type options
          Alert.alert(
            title,
            message,
            [
              {
                text: 'Change Import Type',
                onPress: () => {
                  router.push({
                    pathname: '/import/select-import-type',
                    params: { 
                      csvContent: fileContent,
                      detectedType: provider
                    }
                  } as any);
                }
              },
              {
                text: 'OK',
                style: 'cancel',
                isPreferred: true,
                onPress: () => {
                  const pathname = 
                    provider === 'aib' ? '/import/aib/paste' :
                    provider === 'revolut' ? '/import/revolut/paste' :
                    '/import/csv/paste';
                  router.push({
                    pathname,
                    params: { csvContent: fileContent }
                  } as any);
                }
              },
            ]
          );

        } catch (error) {
          console.error('Error reading CSV file:', error);
          
          // Capture the error in Sentry with context
          captureException(error as Error, {
            contexts: {
              csv_import: {
                fileUrl: event.url,
                errorType: (error as any)?.code || (error as any)?.name || 'unknown',
                errorMessage: (error as any)?.message || String(error),
              }
            },
            tags: {
              feature: 'csv_import',
              event_type: 'file_read_error'
            }
          });
          
          const code = (error as any)?.code || (error as any)?.name || 'unknown';
          const message = (error as any)?.message || String(error);
          Alert.alert('Error', `Failed to read the CSV file.\nCode: ${code}\n${message}`);
        }
      }
    };

    // Handle initial URL (app opened from link)
    Linking.getInitialURL().then((url) => {
      if (url) {
        handleDeepLink({ url });
      }
    });

    // Handle URL when app is already open
    const subscription = Linking.addEventListener('url', handleDeepLink);

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (error) throw error;
    if (fontsLoaded) {
      SplashScreen.hideAsync();
      checkSession();
    }
  }, [fontsLoaded, error]);

  useEffect(() => {
    if (status === "loading" || status === "idle") return;

    // Check if there's a pending password reset - handle it first
    if (pendingPasswordReset.current) {
      const { userId, secret } = pendingPasswordReset.current;
      pendingPasswordReset.current = null;
      addBreadcrumb({ message: 'Navigating to password reset', category: 'navigation', data: { userId } });
      router.push({
        pathname: '/auth/reset-password',
        params: { userId, secret }
      } as any);
      return;
    }

    // /migrate and /onboarding are reachable outside the tabs (pre-auth import
    // and first-run flow), so treat them like the auth group for gating.
    const seg0 = segments[0];
    const inPreAuth = seg0 === "auth" || seg0 === "migrate" || seg0 === "onboarding";

    if (status === "unauthenticated" && !inPreAuth) {
      if (!navigationAttempted.current) {
        navigationAttempted.current = true;
        addBreadcrumb({ message: 'Redirecting to auth (unauthenticated)', category: 'navigation' });
        router.replace("/auth");
      }
    } else if (status === "authenticated" && needsOnboarding && seg0 !== "onboarding" && seg0 !== "migrate") {
      if (!navigationAttempted.current) {
        navigationAttempted.current = true;
        addBreadcrumb({ message: 'Redirecting to onboarding (new user)', category: 'navigation' });
        router.replace("/onboarding");
      }
    } else if (status === "authenticated" && !needsOnboarding && (seg0 === "auth" || seg0 === "onboarding")) {
      if (!navigationAttempted.current) {
        navigationAttempted.current = true;
        addBreadcrumb({ message: 'Redirecting to home (authenticated)', category: 'navigation' });
        router.replace("/");
      }
    } else {
      // Reset flag when in correct route
      navigationAttempted.current = false;
    }
  }, [status, segments, needsOnboarding]);

  // Track route changes for navigation breadcrumbs
  useEffect(() => {
    const path = segments.join('/');
    if (path) {
      addBreadcrumb({
        message: `Navigated to /${path}`,
        category: 'navigation',
        data: { path, segments }
      });
    }
  }, [segments]);

  return (
    <ErrorBoundary fallback={ErrorFallback}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Stack screenOptions={STACK_SCREEN_OPTIONS}>
          <Stack.Screen name="(tabs)" options={TABS_STACK_OPTIONS} />
        </Stack>
        <NotificationTray />
        {status === "icloud-unavailable" && <ICloudGate />}
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
