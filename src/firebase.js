import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
    apiKey: "AIzaSyDYpbz7xD1k5LJl-yROU4HzrOJ-nk5S_D8",
    authDomain: "click-or-die-90ee9.firebaseapp.com",
    databaseURL: "https://click-or-die-90ee9-default-rtdb.firebaseio.com",
    projectId: "click-or-die-90ee9",
    storageBucket: "click-or-die-90ee9.firebasestorage.app",
    messagingSenderId: "133205821699",
    appId: "1:133205821699:web:651d24b06dd0f72d1bc136",
};

const app = initializeApp(firebaseConfig);

export const db = getDatabase(app);
export const auth = getAuth(app);