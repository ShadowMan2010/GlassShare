<img width="1024" height="1024" alt="GlassShare Logo" src="https://raw.githubusercontent.com/ShadowMan2010/GlassShare/main/public/app-icon.png" />

# GlassShare - Open Source WebRTC File Sharing App

GlassShare is a responsive, secure, peer-to-peer file sharing application with a sleek dark side-panel UI. It utilizes WebRTC for secure connections, features rapid QR-code pairing, and implements Screen Wake Lock APIs to ensure files transfer successfully in mobile background states.

## Status

🚧 This project is currently in development.

## 🚀 Key Features

- **Secure WebRTC DataChannels**: Peer-to-peer files are sliced into binary chunks and sent directly between devices with backpressure safety flow control.
- **Dark Side-Panel UI**: Clean right-side panel layout with glassmorphism accents, purple/cyan color scheme, and a minimal main area.
- **Mobile Screen-Off Dim Mode**: Includes a simulated dim screen overlay that keeps the browser CPU running while blacking out the screen to save battery on OLED devices.
- **Screen Wake Lock API**: Prevents system sleep and connection throttling on Android/iOS when the app is active in the background.
- **Pairing QR Scanner**: Displays a pairing configuration payload QR code. Scan the QR code with your other device's camera to establish instant connection tunnels.
- **Two Connection Modules**:
  - *Local Share*: Auto-discovery of active devices connected to the same local subnet.
  - *Device to Device*: Input matching room codes to pair nodes across different routers (WAN).

---

## 🛠️ Project Architecture

```
glassshare/
├── src/
│   ├── main.js             (App state orchestrator)
│   ├── style.css           (Dark theme CSS library)
│   ├── webrtc.js           (Peer RTCPeerConnection chunking engine)
│   ├── wakelock.js         (Mobile Screen Wake Lock & dim utilities)
│   └── qr.js               (Camera QR scanner and generator wrapper)
├── public/
│   ├── app-icon.png        (App icon 1024x1024)
│   ├── manifest.json       (PWA launcher profile)
│   ├── sw.js               (Offline assets service caching)
│   └── icon.svg            (PWA vector icon)
├── server/
│   └── index.js            (Node.js/WebSocket signaling presence server)
├── electron/
│   ├── main.cjs            (Linux desktop container main loop)
│   └── preload.cjs         (Isolated client preload bridge)
├── android/
│   └── [Gradle files]      (Capacitor native Android Gradle container)
└── build/
    └── icon.png            (Electron desktop icon 256x256)
```

---

## 💻 Installation & Setup

Ensure you have [Node.js](https://nodejs.org) (v18+) installed.

### 1. Clone & Install dependencies

```
git clone https://github.com/your-username/glassshare.git
cd glassshare
npm install
```

### 2. Run the Signaling Server

Navigate to the server folder, install the lightweight websocket backend, and boot:

```
cd server
npm install
node index.js
```

*The signaling broker starts listening on port `8080`.*

### 3. Run the Web App (Vite)

From the root directory:

```
npm run dev
```

*Bootstraps the local Vite secure dev server on `https://localhost:5173`. Accept the self-signed SSL dev certificate to test.*

---

## 🐧 Standalone Linux Desktop App (Electron)

GlassShare is fully packaged for Linux systems.

### Development Mode

Runs Vite and launches the Electron application container concurrently:

```
npm run app:dev
```

### Build AppImage / Debian Binary

Compiles assets and bundles the app into static executables:

```
npm run app:build:linux
```

*Outputs compiled binaries inside `dist-desktop/`.*

---

## 🤖 Standalone Android Application (Capacitor)

We use Ionic Capacitor to bridge the HTML5 assets into a native Gradle project.

### Syncing Web Updates

Whenever you modify frontend code, build and sync the changes to the Android native directory:

```
npm run build
npx cap sync android
```

### Compiling Android APK

1.  Open the project in Android Studio:
    ```
    npx cap open android
    ```
2.  Inside Android Studio, press **Run** to launch on a connected Android phone or emulator.
3.  Go to **Build > Build Bundle(s) / APK(s) > Build APK(s)** to compile the release `.apk` file.

*Android permissions (`CAMERA`, `WAKE_LOCK`, `ACCESS_NETWORK_STATE`, and `INTERNET`) are pre-configured inside `android/app/src/main/AndroidManifest.xml`.*

---

## 📄 License

This project is open-source under the terms of the [MIT License](LICENSE).

## 🛠️ CI / GitHub Actions

We provide two GitHub Actions workflows that build distributable artifacts when you push a release tag or run the workflow manually:

- **Linux Desktop**: `.github/workflows/linux-build.yml` — builds the web assets and packages an AppImage and `.deb` using `electron-builder`. Artifacts are uploaded from `dist-desktop/`.
- **Android APK**: `.github/workflows/android-build.yml` — installs the Android SDK and runs the Gradle `assembleRelease` task inside the `android` folder. The resulting APKs are uploaded as workflow artifacts.

Trigger these workflows by pushing a tag like `v1.2.0` or via the Actions tab.

Local quick commands:

- Build and package Linux desktop locally:

  ```
  npm ci
  npm run build
  npm run app:build:linux
  ```

- Build Android release APK locally (ensure Android SDK + Java installed):

  ```
  npm run build
  cd android
  chmod +x gradlew
  ./gradlew assembleRelease
  # APK located at android/app/build/outputs/apk/release/
  ```

## Contributing

Contributions, feedback, and ideas are welcome.
