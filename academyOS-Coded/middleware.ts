import { convexAuthNextjsMiddleware, createRouteMatcher, nextjsMiddlewareRedirect } from "@convex-dev/auth/nextjs/server";

// Everything except the dashboards requires no auth check here — role-based
// access (admin vs teacher vs parent) is enforced client-side via api.auth.me
// plus, for real security, every Convex query/mutation itself (see
// convex/lib/authz.ts) — middleware only handles "signed in at all."
const isProtectedRoute = createRouteMatcher(["/admin(.*)", "/teacher(.*)", "/parent(.*)"]);

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  if (isProtectedRoute(request) && !(await convexAuth.isAuthenticated())) {
    return nextjsMiddlewareRedirect(request, "/login");
  }
});

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
