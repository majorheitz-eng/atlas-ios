import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { palette } from '@/theme/palette';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.canvas }, animation: 'fade' }} />
    </>
  );
}
