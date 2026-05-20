import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodSchema, ZodError } from 'zod';

type Source = 'body' | 'query' | 'params';

export function validate(schema: ZodSchema<any>, source: Source = 'body'): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const data = source === 'body' ? req.body : source === 'query' ? req.query : req.params;
    const result = schema.safeParse(data);
    if (!result.success) {
      const err = result.error as ZodError;
      return res.status(400).json({
        error: 'validation_failed',
        errors: err.issues.map(i => ({
          path: i.path.join('.') || '(root)',
          message: i.message,
          code: i.code,
        })),
      });
    }
    if (source === 'body') req.body = result.data;
    else if (source === 'query') (req as any).validatedQuery = result.data;
    else (req as any).validatedParams = result.data;
    next();
  };
}
