import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  updateProfile,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

// =====================================================
// 1. FIREBASE CONFIGURATION
// =====================================================

const firebaseConfig = {
  apiKey: "AIzaSyAxaZ4um7djqMopJAslYwWcajrNA_B2b8g",
  authDomain: "shobpaben-acbdc.firebaseapp.com",
  projectId: "shobpaben-acbdc",
  storageBucket: "shobpaben-acbdc.firebasestorage.app",
  messagingSenderId: "480239413853",
  appId: "1:480239413853:web:c524eeccfd93134a6fbbb4",
  measurementId: "G-9RKXVNH3Q3"
};

// =====================================================
// 2. INITIALIZE FIREBASE AUTH + FIRESTORE
// =====================================================

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: "select_account"
});

const byId = (id) => document.getElementById(id);

const accountRoot = byId("account-page");

const authInner = document.querySelector(
  "#account-page .account-auth-inner"
);

const authStatus = byId("account-auth-status");

if (!accountRoot || !authInner) {
  console.error(
    "[ShobPaben] Account UI was not found."
  );
}

// =====================================================
// 3. STATUS HELPERS
// =====================================================

function showStatus(message, type = "info") {
  if (!authStatus) return;

  authStatus.textContent = message;
  authStatus.dataset.state = type;
  authStatus.hidden = false;
}

function switchAuthView(viewName) {
  const views = document.querySelectorAll(
    "#account-page [data-auth-view]"
  );

  const selectedView = [...views].find(
    view => view.dataset.authView === viewName
  );

  if (!selectedView) return;

  views.forEach(view => {
    view.hidden = view !== selectedView;
  });

  dashboard.hidden = true;
  clearStatus();
}

function clearStatus() {
  if (!authStatus) return;

  authStatus.textContent = "";
  authStatus.hidden = true;

  delete authStatus.dataset.state;
}

function showProfileStatus(message, type = "info") {
  if (!profileStatus) return;

  profileStatus.textContent = message;
  profileStatus.dataset.state = type;
  profileStatus.hidden = false;
}

function clearProfileStatus() {
  if (!profileStatus) return;

  profileStatus.textContent = "";
  profileStatus.hidden = true;

  delete profileStatus.dataset.state;
}

// =====================================================
// 4. CUSTOMER PROFILE DASHBOARD
// =====================================================

function makeProfileField({
  id,
  label,
  type = "text",
  autocomplete = "off",
  disabled = false
}) {
  const wrapper = document.createElement("div");

  wrapper.className = "account-auth-field";

  const fieldLabel = document.createElement("label");

  fieldLabel.htmlFor = id;
  fieldLabel.textContent = label;

  const input = document.createElement("input");

  input.id = id;
  input.name = id;
  input.type = type;
  input.autocomplete = autocomplete;
  input.disabled = disabled;
  input.className = "account-profile-input";

  wrapper.append(fieldLabel, input);

  return { wrapper, input };
}

// Dashboard container

const dashboard = document.createElement("section");

dashboard.className =
  "account-auth-view account-dashboard-view";

dashboard.hidden = true;

dashboard.setAttribute(
  "aria-labelledby",
  "firebase-profile-heading"
);

// Dashboard heading

const dashboardHeading = document.createElement("h2");

dashboardHeading.id = "firebase-profile-heading";
dashboardHeading.className = "account-auth-title";
dashboardHeading.textContent = "My Account";

// Dashboard description

const dashboardIntro = document.createElement("p");

dashboardIntro.className = "account-auth-description";

dashboardIntro.textContent =
  "View and update your ShobPaben customer information.";

// Profile status

const profileStatus = document.createElement("p");

profileStatus.className = "account-auth-status";
profileStatus.id = "firebase-profile-status";

profileStatus.setAttribute("role", "status");
profileStatus.setAttribute("aria-live", "polite");

profileStatus.hidden = true;

// Profile form

const profileForm = document.createElement("form");

profileForm.id = "firebase-profile-form";
profileForm.className = "account-auth-form";

// Name

const nameField = makeProfileField({
  id: "firebase-profile-name",
  label: "Full Name",
  autocomplete: "name"
});

// Email

const emailField = makeProfileField({
  id: "firebase-profile-email",
  label: "Email Address",
  type: "email",
  autocomplete: "email",
  disabled: true
});

// Phone

const phoneField = makeProfileField({
  id: "firebase-profile-phone",
  label: "Mobile Number",
  type: "tel",
  autocomplete: "tel"
});

// Location

const locationField = makeProfileField({
  id: "firebase-profile-location",
  label: "Delivery Area / Location",
  autocomplete: "address-level2"
});

// Email information

const emailNote = document.createElement("small");

emailNote.textContent =
  "Email is managed by your sign-in provider.";

emailField.wrapper.appendChild(emailNote);

// Save button

const profileSaveButton = document.createElement("button");

profileSaveButton.type = "submit";

profileSaveButton.className =
  "account-auth-primary-button";

profileSaveButton.textContent = "Save Profile";

// Logout button

const logoutButton = document.createElement("button");

logoutButton.type = "button";

logoutButton.className =
  "account-auth-back-button";

logoutButton.textContent = "Sign Out";

logoutButton.dataset.authAction = "logout";

// Add fields to form

profileForm.append(
  nameField.wrapper,
  emailField.wrapper,
  phoneField.wrapper,
  locationField.wrapper,
  profileSaveButton,
  logoutButton
);

// Add dashboard to account panel

dashboard.append(
  dashboardHeading,
  dashboardIntro,
  profileStatus,
  profileForm
);

if (authInner) {
  authInner.appendChild(dashboard);
}

// =====================================================
// 5. FIRESTORE PROFILE HELPERS
// Collection: users
// Document ID: Firebase Authentication UID
// =====================================================

function getUserProfileRef(user) {

  return doc(
    db,
    "users",
    user.uid
  );

}

// Create or retrieve customer profile

async function ensureUserProfile(user) {

  const profileRef = getUserProfileRef(user);

  const profileSnapshot = await getDoc(profileRef);

  // Create new profile if it does not exist

  if (!profileSnapshot.exists()) {

    const initialProfile = {

      uid: user.uid,

      displayName: user.displayName || "",

      email: user.email || "",

      phone: user.phoneNumber || "",

      location: "",

      providers: (user.providerData || []).map(
        item => item.providerId
      ),

      createdAt: serverTimestamp(),

      updatedAt: serverTimestamp()

    };

    await setDoc(profileRef, initialProfile);

    return initialProfile;

  }

  // Existing customer profile

  const existingProfile = profileSnapshot.data();

  const refreshedEmail =
    user.email || existingProfile.email || "";

  // Update email only.
  // Preserve customer-edited name, phone and location.

  if (existingProfile.email !== refreshedEmail) {

    await setDoc(
      profileRef,
      {
        email: refreshedEmail,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

  }

  return {
    ...existingProfile,
    email: refreshedEmail
  };

}

// Save profile after email registration

async function saveNewCustomerProfile(
  user,
  { displayName, phone }
) {

  const profileRef = getUserProfileRef(user);

  const profileSnapshot = await getDoc(profileRef);

  const data = {

    uid: user.uid,

    displayName:
      displayName || user.displayName || "",

    email: user.email || "",

    phone: phone || "",

    location: "",

    providers: (user.providerData || []).map(
      item => item.providerId
    ),

    updatedAt: serverTimestamp()

  };

  if (!profileSnapshot.exists()) {
    data.createdAt = serverTimestamp();
  }

  await setDoc(
    profileRef,
    data,
    { merge: true }
  );

}

// =====================================================
// 6. DISPLAY CUSTOMER PROFILE
// =====================================================

function renderProfile(profile, user) {

  nameField.input.value =
    profile.displayName || user.displayName || "";

  emailField.input.value =
    user.email || profile.email || "";

  phoneField.input.value =
    profile.phone || user.phoneNumber || "";

  locationField.input.value =
    profile.location || "";

  dashboardHeading.textContent =
    profile.displayName
      ? `Welcome, ${profile.displayName}!`
      : "Welcome to ShobPaben!";

}

// =====================================================
// 7. FIREBASE ERROR MESSAGES
// =====================================================

function getAuthError(error) {

  const messages = {

    "auth/email-already-in-use":
      "This email is already registered.",

    "auth/invalid-email":
      "Please enter a valid email address.",

    "auth/weak-password":
      "Password must contain at least 6 characters.",

    "auth/invalid-credential":
      "Incorrect email or password.",

    "auth/user-not-found":
      "No account found with this email.",

    "auth/wrong-password":
      "Incorrect password.",

    "auth/popup-closed-by-user":
      "Google sign-in was cancelled.",

    "auth/popup-blocked":
      "Your browser blocked the Google sign-in popup.",

    "auth/unauthorized-domain":
      "This website domain is not authorized in Firebase.",

    "auth/operation-not-allowed":
      "This sign-in method is not enabled in Firebase.",

    "auth/network-request-failed":
      "Network error. Please check your internet connection.",

    "auth/too-many-requests":
      "Too many attempts. Please try again later.",

    "permission-denied":
      "Firestore denied access. Please check your Firestore Rules.",

    "unavailable":
      "Firestore is temporarily unavailable. Please try again."

  };

  return (
    messages[error.code] ||
    error.message ||
    "Something went wrong. Please try again."
  );

}

// =====================================================
// 8. AUTHENTICATION ACTIONS
// =====================================================

async function handleAuthAction(button) {

  const action = button.dataset.authAction;

  button.disabled = true;

  clearStatus();

  try {

    // =================================
    // EMAIL LOGIN
    // =================================

    if (action === "login") {

      const email =
        byId("account-login-email")?.value.trim() || "";

      const password =
        byId("account-login-password")?.value || "";

      const remember =
        byId("account-remember-me")?.checked || false;

      if (!email || !password) {

        throw new Error(
          "Enter your email and password."
        );

      }

      await setPersistence(
        auth,
        remember
          ? browserLocalPersistence
          : browserSessionPersistence
      );

      await signInWithEmailAndPassword(
        auth,
        email,
        password
      );

    }

    // =================================
    // EMAIL REGISTRATION
    // =================================

    else if (action === "register") {

      const name =
        byId("account-register-name")?.value.trim() || "";

      const email =
        byId("account-register-email")?.value.trim() || "";

      const phone =
        byId("account-register-phone")?.value.trim() || "";

      const password =
        byId("account-register-password")?.value || "";

      const confirmPassword =
        byId("account-register-confirm-password")?.value || "";

      if (
        !name ||
        !email ||
        !password ||
        !confirmPassword
      ) {

        throw new Error(
          "Please complete your name, email and password fields."
        );

      }

      if (password.length < 6) {

        throw new Error(
          "Password must contain at least 6 characters."
        );

      }

      if (password !== confirmPassword) {

        throw new Error(
          "Passwords do not match."
        );

      }

      await setPersistence(
        auth,
        browserLocalPersistence
      );

      const credential =
        await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );

      // Save customer name to Firebase Auth

      await updateProfile(
        credential.user,
        {
          displayName: name
        }
      );

      // Save customer information to Firestore

      await saveNewCustomerProfile(
        credential.user,
        {
          displayName: name,
          phone: phone
        }
      );

      showStatus(
        "Your account and customer profile were created successfully.",
        "success"
      );

    }

    // =================================
    // GOOGLE LOGIN / REGISTRATION
    // =================================

    else if (action === "google") {

      const remember =
        byId("account-remember-me")?.checked ?? true;

      await setPersistence(
        auth,
        remember
          ? browserLocalPersistence
          : browserSessionPersistence
      );

      await signInWithPopup(
        auth,
        googleProvider
      );

    }

    // =================================
    // FORGOT PASSWORD
    // =================================

    else if (action === "reset-password") {

      const email =
        byId("account-reset-email")?.value.trim() || "";

      if (!email) {

        throw new Error(
          "Enter your registered email address."
        );

      }

      await sendPasswordResetEmail(
        auth,
        email
      );

      showStatus(
        "Password reset email sent. Please check your inbox.",
        "success"
      );

    }

    // =================================
    // LOGOUT
    // =================================

    else if (action === "logout") {

      await signOut(auth);

    }

  } catch (error) {

    console.error(
      "[ShobPaben Firebase Auth]",
      error
    );

    showStatus(
      getAuthError(error),
      "error"
    );

  } finally {

    button.disabled = false;

  }

}

// =====================================================
// 9. AUTHENTICATION BUTTON EVENT LISTENER
// =====================================================

if (accountRoot) {

  accountRoot.addEventListener(
    "click",
    (event) => {

      const target = event.target;

      if (!(target instanceof Element)) return;

      // Switch Login / Register / Forgot Password

      const switchButton =
        target.closest("[data-auth-switch]");

      if (switchButton) {

        switchAuthView(
          switchButton.dataset.authSwitch
        );

        return;

      }

      // Authentication actions

      const actionButton =
        target.closest("[data-auth-action]");

      if (actionButton) {

        event.preventDefault();

        handleAuthAction(actionButton);

      }

    }
  );

}

// =====================================================
// 10. SAVE CUSTOMER PROFILE TO FIRESTORE
// =====================================================

profileForm.addEventListener(
  "submit",
  async (event) => {

    event.preventDefault();

    const user = auth.currentUser;

    if (!user) {

      showProfileStatus(
        "Please sign in again to update your profile.",
        "error"
      );

      return;

    }

    const displayName =
      nameField.input.value.trim();

    const phone =
      phoneField.input.value.trim();

    const location =
      locationField.input.value.trim();

    if (!displayName) {

      showProfileStatus(
        "Please enter your full name.",
        "error"
      );

      nameField.input.focus();

      return;

    }

    if (
      displayName.length > 80 ||
      phone.length > 25 ||
      location.length > 120
    ) {

      showProfileStatus(
        "Please check the length of your profile information.",
        "error"
      );

      return;

    }

    profileSaveButton.disabled = true;

    clearProfileStatus();

    try {

      // Update Firebase Authentication display name

      await updateProfile(
        user,
        {
          displayName: displayName
        }
      );

      // Update Firestore customer profile

      await setDoc(
        getUserProfileRef(user),
        {

          uid: user.uid,

          displayName: displayName,

          email: user.email || "",

          phone: phone,

          location: location,

          providers: (user.providerData || []).map(
            item => item.providerId
          ),

          updatedAt: serverTimestamp()

        },
        {
          merge: true
        }
      );

      dashboardHeading.textContent =
        `Welcome, ${displayName}!`;

      showProfileStatus(
        "Your profile has been saved successfully.",
        "success"
      );

    } catch (error) {

      console.error(
        "[ShobPaben Profile Save]",
        error
      );

      showProfileStatus(
        getAuthError(error),
        "error"
      );

    } finally {

      profileSaveButton.disabled = false;

    }

  }
);

// =====================================================
// 11. AUTHENTICATION STATE + LOAD CUSTOMER PROFILE
// =====================================================

onAuthStateChanged(
  auth,
  async (user) => {

    // CUSTOMER LOGGED OUT

    if (!user) {

      dashboard.hidden = true;

      switchAuthView("login");

      return;

    }

    // CUSTOMER LOGGED IN

    accountRoot?.querySelectorAll(
      "[data-auth-view]"
    ).forEach((view) => {

      view.hidden = true;

    });

    dashboard.hidden = false;

    clearStatus();

    showProfileStatus(
      "Loading your customer profile..."
    );

    try {

      // Get or create customer profile

      const profile =
        await ensureUserProfile(user);

      // Display customer information

      renderProfile(
        profile,
        user
      );

      clearProfileStatus();

    } catch (error) {

      console.error(
        "[ShobPaben Firestore Profile Load]",
        error
      );

      // Keep the customer signed in even if
      // Firestore temporarily fails.

      renderProfile(
        {
          displayName: user.displayName || "",
          email: user.email || ""
        },
        user
      );

      showProfileStatus(
        "You are signed in, but your profile could not be loaded from Firestore. " +
        getAuthError(error),
        "error"
      );

    }

  }
);

console.log(
  "[ShobPaben] Firebase Authentication and Firestore profile integration initialized."
);