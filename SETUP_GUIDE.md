# Atlas iPhone Setup Guide

## ✅ What's Already Done

1. **Build 11** is uploaded to TestFlight and ready
2. **You're added** as a tester (captainmajorh@gmail.com)
3. **Hermes backend** is running on your computer
4. **Cloudflare Tunnel** is active - securely exposing Hermes to your iPhone

## 📱 Step 1: Open Atlas on Your iPhone

1. Find the **Atlas** app on your iPhone (just downloaded from TestFlight)
2. Tap to open it

## 🔧 Step 2: Enter Gateway Configuration

When Atlas opens for the first time, you'll see a setup screen:

**Gateway URL:**
```
https://lyrics-mechanisms-careers-parliamentary.trycloudflare.com
```

**Access Token:**
```
eyJhbG...84g8
```

*(This is your permanent access token - it's stored securely in your iPhone Keychain)*

## 🎤 Step 3: Grant Permissions

Atlas will ask for:

1. **Microphone Access** → Tap "Allow" (needed for voice commands)
2. **Speech Recognition** → Tap "Allow" (Apple's transcription)
3. **Face ID** → Tap "OK" (for approving sensitive actions)

## 🏠 Step 4: Create "Ask Atlas" Shortcut

Since Apple doesn't allow third-party apps to replace Siri:

1. Open the **Shortcuts** app on your iPhone
2. Tap the **+** button (top right)
3. Tap **"Add Action"**
4. Search for **"URL"** and select it
5. In the URL field, type: `atlas://talk`
6. Tap the **⋯** (three dots) at the top
7. Name it: **Ask Atlas**
8. Tap **Done**

### Optional: Add to Action Button

1. Go to **Settings** → **Action Button**
2. Scroll down and select **"Ask Atlas"** shortcut

Now when you press your Action Button, Atlas opens and starts listening!

## 🧪 Step 5: Test It

1. Open Atlas (tap the app or press Action Button)
2. Say: *"What's the weather today?"* or *"Tell me a joke"*
3. Atlas sends it to Hermes → Hermes responds → Atlas speaks it back

## 🔒 Security Notes

- Your Hermes backend runs on **your computer only** (127.0.0.1:9119)
- Cloudflare Tunnel provides **encrypted HTTPS** - no open ports on your router
- The tunnel URL changes each time you restart it
- **Never commit** gateway tokens to GitHub

## 🛑 Stopping the Backend

When you're done testing:

1. On your computer, the Hermes server and Cloudflare tunnel are running in the background
2. To stop them, just close your computer or I can stop the processes for you

## 📞 Need Help?

If Atlas shows connection errors:
- Make sure your computer is awake and connected to WiFi
- The tunnel URL might have changed (check with me)
- Try closing and reopening the Atlas app

---

**Current Setup:**
- PERMANENT public URL (any WiFi/cellular): https://petroleum-multiply-backtalk.ngrok-free.dev
- Home LAN shortcut: http://192.168.4.22:9121
- Access Token (everywhere): atlas-iphone-2026
- Hermes: http://127.0.0.1:9119 on PC
- All three auto-start at login; ngrok auto-reconnects