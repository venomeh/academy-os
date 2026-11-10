"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import AdminApp from "@/components/admin/AdminApp";

function roleHome(role: "admin" | "teacher" | "parent") {
  return role === "admin" ? "/admin" : role === "teacher" ? "/teacher" : "/parent";
}

export default function AdminPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const me = useQuery(api.auth.me, isAuthenticated ? {} : "skip");

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace("/login");
      return;
    }
    if (me === undefined) return; // still loading
    if (me === null) {
      router.replace("/login");
      return;
    }
    if (me.role !== "admin") {
      router.replace(roleHome(me.role));
    }
  }, [isLoading, isAuthenticated, me, router]);

  if (!me || me.role !== "admin") return null;
  return <AdminApp session={me} />;
}
