import { useAutoSync } from "@/hooks/useAutoSync";
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

  const { checkSession, status } = useSessionStore();
  const router = useRouter();
  const segments = useSegments();
  const navigationAttempted = useRef(false);
  // Track pending password reset to handle after initial navigation
  const pendingPasswordReset = useRef<{ userId: string; secret: string } | null>(null);

  // Enable auto-sync
  useAutoSync();

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

      // Handle file:// URLs (CSV files shared to the app)
      if (event.url.startsWith('file://')) {
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

          // Log successful file read with file size
          captureMessage('CSV import: File read successfully', {
            level: 'info',
            contexts: {
              csv_import: {
                fileUrl: event.url,
                tempPath,
                fileSize: fileContent.length,
                fileSizeKB: Math.round(fileContent.length / 1024)
              }
            },
            tags: {
              feature: 'csv_import',
              event_type: 'file_read_success'
            }
          });

          // Detect the CSV provider (AIB or Revolut)
          const provider = detectCSVProvider(fileContent);

          if (provider === 'unknown') {
            Alert.alert(
              'Unrecognized Format',
              'Could not determine if this is an AIB or Revolut CSV file. Please select the provider manually.',
              [
                {
                  text: 'AIB',
                  onPress: () => {
                    router.push({
                      pathname: '/import/aib/paste',
                      params: { csvContent: fileContent }
                    } as any);
                  }
                },
                {
                  text: 'Revolut',
                  onPress: () => {
                    router.push({
                      pathname: '/import/revolut/paste',
                      params: { csvContent: fileContent }
                    } as any);
                  }
                },
                { text: 'Cancel', style: 'cancel' }
              ]
            );
            return;
          }

          // Route to the appropriate import screen
          const pathname = provider === 'aib' ? '/import/aib/paste' : '/import/revolut/paste';
          router.push({
            pathname,
            params: { csvContent: fileContent }
          } as any);

          Alert.alert(
            'CSV Detected',
            `Detected ${provider.toUpperCase()} format. Loading import screen...`
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

    const inAuthGroup = segments[0] === "auth";

    if (status === "unauthenticated" && !inAuthGroup) {
      if (!navigationAttempted.current) {
        navigationAttempted.current = true;
        addBreadcrumb({ message: 'Redirecting to auth (unauthenticated)', category: 'navigation' });
        router.replace("/auth");
      }
    } else if (status === "authenticated" && inAuthGroup) {
      if (!navigationAttempted.current) {
        navigationAttempted.current = true;
        addBreadcrumb({ message: 'Redirecting to home (authenticated)', category: 'navigation' });
        router.replace("/");
      }
    } else {
      // Reset flag when in correct route
      navigationAttempted.current = false;
    }
  }, [status, segments]);

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
        <Stack screenOptions={{ headerShown: false }} />
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
