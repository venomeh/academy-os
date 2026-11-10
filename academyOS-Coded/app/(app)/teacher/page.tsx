"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import TeacherApp from "@/components/teacher/TeacherApp";

function roleHome(role: "admin" | "teacher" | "parent") {
  return role === "admin" ? "/admin" : role === "teacher" ? "/teacher" : "/parent";
}

export default function TeacherPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const me = useQuery(api.auth.me, isAuthenticated ? {} : "skip");

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace("/login");
      return;
    }
    if (me === undefined) return;
    if (me === null || me.role !== "teacher") {
      router.replace(me ? roleHome(me.role) : "/login");
    }
  }, [isLoading, isAuthenticated, me, router]);

  if (!me || me.role !== "teacher") return null;
  return <TeacherApp session={me} />;
}
