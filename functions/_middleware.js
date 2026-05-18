export async function onRequest(context) {
  const { request, env, next } = context;
  const user = env.BASIC_AUTH_USER;
  const password = env.BASIC_AUTH_PASSWORD;

  if (!user || !password) {
    return next();
  }

  const authorization = request.headers.get("Authorization") || "";
  const expected = `Basic ${btoa(`${user}:${password}`)}`;

  if (authorization === expected) {
    return next();
  }

  return new Response("需要账号密码", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Piggy Portfolio"',
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
