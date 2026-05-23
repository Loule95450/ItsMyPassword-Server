/**
 * Translation tables for the admin UI. Two locales: `fr` (default) and
 * `en`. Adding a new locale = adding a `Record<Key, string>` here.
 *
 * Keys are flat dot-separated paths. Values may use {placeholders} that
 * the t() helper substitutes.
 */
export const LOCALES = ["fr", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "fr";

export const TRANSLATIONS = {
  fr: {
    "brand.admin": "Admin",
    "header.connectedAs": "connecté en tant que {username}",
    "header.logout": "Se déconnecter",
    "header.theme": "Basculer le thème",
    "header.language": "Langue",
    "common.loading": "Chargement…",
    "common.cancel": "Annuler",
    "common.refresh": "Rafraîchir",
    "common.confirm": "Confirmer",
    "footer.tagline": "Keyfount Server · Admin",

    // Setup
    "setup.label": "étape 0 · setup",
    "setup.title": "Bienvenue.",
    "setup.intro":
      "Cette installation n'a pas encore d'administrateur. Crée le tien ci-dessous. Ce compte servira à approuver les utilisateurs qui demandent à synchroniser leur extension sur ce serveur.",
    "setup.username": "Nom d'utilisateur",
    "setup.password": "Mot de passe",
    "setup.password.help":
      "Choisis un mot de passe long et unique. Il sera traité par OPAQUE : le serveur ne le verra jamais en clair, même pendant que tu le tapes.",
    "setup.confirm": "Confirme le mot de passe",
    "setup.submit": "Créer mon compte admin",
    "setup.submitting": "Création…",
    "setup.lockedNote":
      "Une fois ton compte créé, le setup est verrouillé : plus personne ne pourra ouvrir cet écran.",
    "setup.error.mismatch": "Les deux mots de passe diffèrent.",
    "setup.error.tooShort": "Le mot de passe doit faire au moins 8 caractères.",

    // Login
    "login.label": "authentification",
    "login.title": "Connexion administrateur",
    "login.intro": "Identifie-toi pour voir les demandes en attente.",
    "login.username": "Nom d'utilisateur",
    "login.password": "Mot de passe",
    "login.submit": "Se connecter",
    "login.submitting": "Connexion…",

    // Dashboard
    "dashboard.label": "tableau de bord",
    "dashboard.title": "Utilisateurs",
    "dashboard.intro":
      "Approuve, refuse, révoque ou supprime les comptes de synchronisation.",
    "dashboard.tab.pending": "En attente",
    "dashboard.tab.approved": "Approuvés",
    "dashboard.tab.rejected": "Refusés",
    "dashboard.tab.all": "Tous",
    "dashboard.empty": "Aucun utilisateur dans cette catégorie.",
    "dashboard.errorLoading": "Erreur de chargement : {message}",

    // Row labels
    "row.status.pending": "En attente",
    "row.status.approved": "Approuvé",
    "row.status.rejected": "Refusé",
    "row.requested": "Demandé : {date}",
    "row.decided": "Décidé : {date}",
    "row.lastSeen": "Vu : {date}",
    "row.reason": "Raison : {reason}",

    // Actions
    "action.approve": "Approuver",
    "action.approveAgain": "Approuver à nouveau",
    "action.reject": "Refuser",
    "action.revoke": "Révoquer",
    "action.delete": "Supprimer",
    "action.deleteWithEllipsis": "Supprimer…",

    // Confirmation modals
    "confirm.reject.title": "Refuser cette demande ?",
    "confirm.reject.body":
      "L'utilisateur verra l'éventuelle raison sur sa page de connexion.",
    "confirm.reject.ok": "Refuser",
    "confirm.revoke.title": "Révoquer cet utilisateur approuvé ?",
    "confirm.revoke.body":
      "Il sera repassé en 'rejected', toutes ses sessions sont invalidées. Tu peux le réapprouver plus tard.",
    "confirm.revoke.ok": "Révoquer",
    "confirm.delete.title": "Supprimer définitivement ce compte ?",
    "confirm.delete.body":
      "Cette action efface l'utilisateur, ses appareils, sessions, événements et snapshots. Irréversible.",
    "confirm.delete.ok": "Supprimer",
    "confirm.reasonLabel": "Raison (facultatif)",

    // Errors
    "error.invalidLogin": "Identifiants refusés.",
    "error.setupLocked":
      "Le setup admin est déjà verrouillé : un compte existe.",
    "error.rateLimit": "Trop de tentatives. Patiente quelques minutes.",
    "error.actionFailed": "Échec : {message}",
  },

  en: {
    "brand.admin": "Admin",
    "header.connectedAs": "signed in as {username}",
    "header.logout": "Sign out",
    "header.theme": "Toggle theme",
    "header.language": "Language",
    "common.loading": "Loading…",
    "common.cancel": "Cancel",
    "common.refresh": "Refresh",
    "common.confirm": "Confirm",
    "footer.tagline": "Keyfount Server · Admin",

    "setup.label": "step 0 · setup",
    "setup.title": "Welcome.",
    "setup.intro":
      "This server has no administrator yet. Create yours below. This account will approve the users requesting to sync their extension to this server.",
    "setup.username": "Username",
    "setup.password": "Password",
    "setup.password.help":
      "Pick a long, unique password. It runs through OPAQUE: the server never sees it in clear, even while you type.",
    "setup.confirm": "Confirm password",
    "setup.submit": "Create my admin account",
    "setup.submitting": "Creating…",
    "setup.lockedNote":
      "Once your account exists, setup is locked: nobody else can open this screen.",
    "setup.error.mismatch": "The two passwords don't match.",
    "setup.error.tooShort": "Password must be at least 8 characters.",

    "login.label": "authentication",
    "login.title": "Admin sign-in",
    "login.intro": "Sign in to see the pending requests.",
    "login.username": "Username",
    "login.password": "Password",
    "login.submit": "Sign in",
    "login.submitting": "Signing in…",

    "dashboard.label": "dashboard",
    "dashboard.title": "Users",
    "dashboard.intro": "Approve, reject, revoke or delete sync accounts.",
    "dashboard.tab.pending": "Pending",
    "dashboard.tab.approved": "Approved",
    "dashboard.tab.rejected": "Rejected",
    "dashboard.tab.all": "All",
    "dashboard.empty": "No users in this category.",
    "dashboard.errorLoading": "Loading error: {message}",

    "row.status.pending": "Pending",
    "row.status.approved": "Approved",
    "row.status.rejected": "Rejected",
    "row.requested": "Requested: {date}",
    "row.decided": "Decided: {date}",
    "row.lastSeen": "Seen: {date}",
    "row.reason": "Reason: {reason}",

    "action.approve": "Approve",
    "action.approveAgain": "Approve again",
    "action.reject": "Reject",
    "action.revoke": "Revoke",
    "action.delete": "Delete",
    "action.deleteWithEllipsis": "Delete…",

    "confirm.reject.title": "Reject this request?",
    "confirm.reject.body":
      "The user will see the optional reason on their login page.",
    "confirm.reject.ok": "Reject",
    "confirm.revoke.title": "Revoke this approved user?",
    "confirm.revoke.body":
      "They'll be set back to 'rejected', every session is invalidated. You can approve them again later.",
    "confirm.revoke.ok": "Revoke",
    "confirm.delete.title": "Permanently delete this account?",
    "confirm.delete.body":
      "This wipes the user, their devices, sessions, events and snapshots. Cannot be undone.",
    "confirm.delete.ok": "Delete",
    "confirm.reasonLabel": "Reason (optional)",

    "error.invalidLogin": "Credentials refused.",
    "error.setupLocked": "Admin setup is locked: an account already exists.",
    "error.rateLimit": "Too many attempts. Wait a few minutes.",
    "error.actionFailed": "Failed: {message}",
  },
} as const satisfies Record<Locale, Record<string, string>>;

export type TranslationKey = keyof (typeof TRANSLATIONS)["fr"];
