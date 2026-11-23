/** GET /api/v1 — machine-readable API index. Full contracts: docs/API.md */
export const dynamic = "force-static";

export function GET() {
  return Response.json({
    name: "AgriSense API",
    version: "v1",
    docs: "/docs/API.md in the repository",
    auth: "Session cookie (httpOnly) for users; X-Device-Id + Bearer key for IoT devices",
    endpoints: {
      auth: ["POST /auth/register", "POST /auth/login", "POST /auth/logout", "GET /auth/me", "POST /auth/forgot-password", "POST /auth/reset-password", "POST /auth/verify-email", "POST /auth/resend-verification"],
      users: ["GET|PATCH|DELETE /users/profile", "GET|PATCH /users/preferences", "PATCH /users/password", "GET /users/export"],
      farms: ["GET|POST /farms", "GET|PATCH|DELETE /farms/{id}", "GET /farms/{id}/weather", "GET /farms/{id}/soil", "GET /farms/{id}/risks", "GET /farms/{id}/recommendations", "GET|POST /farms/{id}/activities", "GET /farms/{id}/readings", "GET /farms/{id}/predictions"],
      crops: ["GET /crops"],
      plantings: ["GET|POST /plantings", "GET|PATCH|DELETE /plantings/{id}"],
      devices: ["GET|POST /devices", "GET|PATCH|DELETE /devices/{id}", "POST /devices/{id} (rotate-key)", "GET /devices/{id}/readings"],
      iot: ["POST /iot/readings"],
      predictions: ["GET|POST /predictions", "GET /predictions/{id}"],
      recommendations: ["PATCH /recommendations/{id}"],
      notifications: ["GET|POST /notifications", "PATCH /notifications/{id}", "GET|POST /notifications/push"],
      reports: ["GET /reports/farms/{id}?type=summary|readings|weather|plantings|predictions"],
      dashboard: ["GET /dashboard"],
      admin: ["GET /admin/stats|users|audit|crops", "PATCH /admin/users|crops", "POST /admin/announcements"],
      geo: ["GET /geo?q=", "GET /geo?lat=&lng="],
    },
  });
}
