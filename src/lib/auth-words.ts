import { PRODUCT_NAME } from "@ncat-dash/automation-core";

/** The titles of the sign-in and sign-up screens; their buttons keep the short words. */
export const HEADINGS = {
  signIn: `Sign in to ${PRODUCT_NAME}`,
  signUp: `Create your ${PRODUCT_NAME} account`,
} as const;

/** The dashboard's own words where Better Auth UI's differ: sentence case, plain, kind. */
export const LOCALIZATION = {
  auth: {
    signIn: "Sign in",
    signUp: "Create account",
    signOut: "Sign out",
    forgotPassword: "Reset your password",
    resetPassword: "Choose a new password",
    verifyEmail: "Confirm your email address",
    email: "Email address",
    emailPlaceholder: "",
    name: "Your name",
    namePlaceholder: "",
    passwordPlaceholder: "",
    newPasswordPlaceholder: "",
    needToCreateAnAccount: "New here?",
    checkYourEmail: "We sent you a link. Open it to confirm your address and you're signed in.",
    verificationEmailSent: "A new link is on its way.",
    resetLinkSentTo: "If {{email}} has an account, a link to choose a new password is on its way.",
    passwordResetSuccessDescription: "Password changed. Sign in with the new one.",
    invalidResetPasswordToken: "This link no longer works. Reset links work once, for one hour.",
  },
  settings: {
    currentPasswordPlaceholder: "",
    userProfile: "Profile",
    changeEmail: "Email address",
    changeEmailSuccess:
      "Check your inbox: approve the change from your current address, then confirm the new one.",
    changePassword: "Password",
    changePasswordSuccess: "Password changed. Your other devices were signed out.",
    activeSessions: "Where you're signed in",
    currentSession: "This device",
    revokeSession: "Sign out this device",
    revokeSessionSuccess: "That device is signed out.",
    signOutOtherDevicesSuccess: "Every other device is signed out.",
    linkedAccounts: "Sign in with",
  },
} as const;
