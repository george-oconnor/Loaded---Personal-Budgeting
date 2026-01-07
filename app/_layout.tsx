import { useAutoSync } from "@/hooks/useAutoSync";
import { detectCSVProvider } from "@/lib/csvDetector";
import { captureException, captureMessage, initSentry } from "@/lib/sentry";
import { useSessionStore } from "@/store/useSessionStore";
import * as FileSystem from 'expo-file-system';
import { useFonts } from "expo-font";
import * as Linking from 'expo-linking';
import { SplashScreen, Stack, useRouter, useSegments } from "expo-router";
import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import './globals.css';

// Initialize Sentry before app renders
initSentry();

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
        captureMessage('CSV import: Handler invoked', {
          level: 'info',
          contexts: {
            csv_import: {
              fileUrl: event.url,
              urlScheme: event.url.split('://')[0]
            }
          },
          tags: {
            feature: 'csv_import',
            event_type: 'handler_invoked'
          }
        });
        
        try {
          // Read the file content
          console.log('CSV import: Attempting to read file...');
          const fileContent = await FileSystem.readAsStringAsync(event.url);
          console.log('CSV import: File read successful, length:', fileContent?.length);
          
          if (!fileContent || fileContent.trim().length === 0) {
            captureMessage('CSV import: Empty file detected', {
              level: 'warning',
              contexts: {
                csv_import: {
                  fileUrl: event.url,
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
          
          Alert.alert(
            'Error',
            'Failed to read the CSV file. Please try again.'
          );
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
        router.replace("/auth");
      }
    } else if (status === "authenticated" && inAuthGroup) {
      if (!navigationAttempted.current) {
        navigationAttempted.current = true;
        router.replace("/");
      }
    } else {
      // Reset flag when in correct route
      navigationAttempted.current = false;
    }
  }, [status, segments]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
    </GestureHandlerRootView>
  );
}
