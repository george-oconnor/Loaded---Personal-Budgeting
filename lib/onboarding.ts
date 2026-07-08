/**
 * First-run onboarding flag. New Sign-in-with-Apple users (no existing CloudKit
 * profile) are walked through intro slides, name capture, an optional Appwrite
 * import, and budget setup. Returning/migrated users (who already have a profile
 * name) skip it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const ONBOARDING_KEY = 'onboarding_complete_v1';

export async function hasOnboarded(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ONBOARDING_KEY)) === 'true';
  } catch {
    return false;
  }
}

export async function setOnboarded(): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
  } catch {
    // best effort
  }
}

export async function resetOnboarding(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ONBOARDING_KEY);
  } catch {
    // best effort
  }
}
