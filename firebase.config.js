export default {
    apiKey: process.env.FIREBASE_API_KEY ?? "",
    authDomain: process.env.FIREBASE_AUTHDOMAIN ?? "gorda.local",
    projectId: process.env.FIREBASE_PROJECT_ID ?? "gorda-local",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET ?? "gorda-local",
    messagingSenderId: process.env.FIREBASE_MESSAGING_ID ?? "12345678900",
    appId: process.env.FIREBASE_APP_ID ?? "1:412940684394:web:40f1a71786e91a53040e13",
    measurementId: process.env.FIREBASE_MEASUREMENT_ID ?? "G-858886884"
}

