import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export interface AuthUserView {
  id: string;
  email?: string | null;
}

export function useAuth() {
  const [authUser, setAuthUser] = useState<AuthUserView | null>(null);
  const [authMessage, setAuthMessage] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const params = new URLSearchParams(window.location.search);
      const errDesc = params.get("error_description");
      const err = params.get("error");

      if (err || errDesc) {
        const msg =
          errDesc?.replace(/\+/g, " ") ||
          err ||
          "Authentication error. Check Supabase redirect URLs.";
        setAuthMessage(msg);
      }

      if (window.location.search.length > 0) {
        window.history.replaceState(
          {},
          document.title,
          window.location.pathname,
        );
      }

      const { data } = await supabase.auth.getUser();
      if (!cancelled) {
        if (data.user) {
          setAuthUser({ id: data.user.id, email: data.user.email });
        } else {
          setAuthUser(null);
        }
      }
    };

    void init();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user;
      setAuthUser(u ? { id: u.id, email: u.email } : null);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    setAuthMessage("");
    await supabase.auth.signOut();
  };

  const signInWithGoogle = async (redirectPath = "/"): Promise<void> => {
  const redirectTo = new URL(redirectPath, window.location.origin).toString();
  console.log("[AUTH] origin:", window.location.origin);
  console.log("[AUTH] redirectTo:", redirectTo);

  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
};

  return {
    authUser,
    authMessage,
    signOut,
    signInWithGoogle,
  };
}
