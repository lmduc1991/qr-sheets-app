import { useEffect, useState } from "react";
import netlifyIdentity from "netlify-identity-widget";

export default function LoginStatus() {
  const [user, setUser] = useState(netlifyIdentity.currentUser());

  useEffect(() => {
    netlifyIdentity.on("login", user => setUser(user));
    netlifyIdentity.on("logout", () => setUser(null));

    return () => {
      netlifyIdentity.off("login");
      netlifyIdentity.off("logout");
    };
  }, []);

  if (!user) {
    return (
      <button onClick={() => netlifyIdentity.open("login")}>
        Login
      </button>
    );
  }

  return (
    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
      <span style={{ fontSize: "12px" }}>
        {user.email}
      </span>
      <button onClick={() => netlifyIdentity.logout()}>
        Logout
      </button>
    </div>
  );
}
