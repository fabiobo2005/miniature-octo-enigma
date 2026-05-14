import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

app.http('healthcheck', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: async (_req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    ctx.log('healthcheck');
    return {
      status: 200,
      jsonBody: { status: 'ok', ts: new Date().toISOString(), version: '1.0.0' }
    };
  }
});
