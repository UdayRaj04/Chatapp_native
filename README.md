# Seamless Chat App

A modern, secure chat application built with **React Native** (frontend) and **Node.js/Express** (backend). Features real-time messaging, end-to-end encryption, user profiles with avatars, and WebRTC-based audio/video calling.

## Download & Use App (using this link) 
https://drive.google.com/file/d/1Hns5G44GSFlrL8H_9EIcBX0Yo_xa6PYn
---

## Features

- **User Authentication** (JWT)
- **Real-time Messaging** (Socket.io)
- **End-to-End Encryption** (AES)
- **User Profiles** (with avatar upload)
- **Online Status** (see who's online)
- **Audio/Video Calls** (WebRTC, mobile & web)
- **Responsive UI** (React Native for Android, iOS, Web)
- **Search & Chat List** (find and chat with users)
- **Profile Editing** (bio, Instagram, avatar)

---

## Tech Stack

- **Frontend:** React Native (Expo), TypeScript, Socket.io-client, CryptoJS, Axios
- **Backend:** Node.js, Express, MongoDB (Mongoose), Socket.io, Multer (file upload), JWT
- **WebRTC:** react-native-webrtc (mobile), browser APIs (web)

---

## Getting Started

### Prerequisites

- Node.js (v18+ recommended)
- npm or yarn
- MongoDB (local or Atlas)
- [Expo CLI](https://docs.expo.dev/get-started/installation/) (for React Native)

---

### 1. Clone the Repository

```bash
git clone https://github.com/udayraj04/chatapp.git
cd chatapp
```

---

### 2. Backend Setup

```bash
cd chat-app-backend
npm install
```

- Create a `.env` file in `chat-app-backend`:

  ```
  MONGO_URI=your_mongodb_connection_string
  JWT_SECRET=your_jwt_secret
  PORT=5000
  ```

- Start the backend server:

  ```bash
  npm start
  ```

---

### 3. Frontend Setup

```bash
cd ../ChatAppFrontend
npm install
```

- Update `config.js` with your backend API base URL if needed.

- Start the app:

  ```bash
  npx expo start
  ```

- Run on Android/iOS device/emulator or in the browser.

---

## Usage

1. **Register** a new account or **login**.
2. **Browse/Search** users, start chats, or make calls.
3. **Edit your profile** and upload an avatar.
4. **Enjoy secure, real-time communication!**

---

## Folder Structure

```
chat-app-backend/      # Node.js backend (Express, MongoDB)
ChatAppFrontend/       # React Native frontend (Expo)
```

---

## Notes

- **WebRTC calls** require HTTPS for web browsers.
- For mobile calls, use a custom dev client (not Expo Go).
- Avatar uploads are stored in `/uploads` on the backend.

---

## License

MIT

---

## Credits

- Designed & developed by UdayRaj
