import { Router } from './router';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Container } from './container';
import { ValidationPipe } from './pipes/validation.pipe';

type Parameter = {
    type: 'param' | 'query' | 'body';
    name?: string;
};

export class Dispatcher {
    private validationPipe = new ValidationPipe();

    constructor(
        private router: Router,
        private container: Container,
    ) {}

    async handle(req: IncomingMessage, res: ServerResponse) {
        const result = this.router.match(req.method!, req.url!);

        if (!result) {
            res.statusCode = 404;
            return res.end('404 Not Found');
        }

        const { route, params } = result;

        const controller = this.container.resolve(route.controller) as Record<
            string | symbol,
            (...args: any[]) => any
        >;

        const handler = controller[route.handler];

        const parameters = Reflect.getMetadata('parameters', route.controller.prototype)?.[
            route.handler
        ] as Record<string, Parameter> | undefined;

        const paramTypes = Reflect.getMetadata(
            'design:paramtypes',
            route.controller.prototype,
            route.handler,
        );

        const url = new URL(req.url!, `http://${req.headers.host}`);

        const query: Record<string, string> = {};

        url.searchParams.forEach((value, key) => {
            query[key] = value;
        });

        let body: unknown;

        if (parameters) {
            const hasBody = Object.values(parameters).some(
                (parameter) => parameter.type === 'body',
            );

            if (hasBody) {
                const rawBody = await this.readBody(req);

                body = rawBody ? JSON.parse(rawBody) : undefined;
            }
        }

        try {
            const args: unknown[] = [];

            if (parameters) {
                for (const [index, parameter] of Object.entries(parameters)) {
                    const parameterIndex = Number(index);
                    const metatype = paramTypes[parameterIndex];

                    if (parameter.type === 'param') {
                        args[parameterIndex] = params[parameter.name!];
                    }

                    if (parameter.type === 'query') {
                        args[parameterIndex] = query[parameter.name!];
                    }

                    if (parameter.type === 'body') {
                        args[parameterIndex] = await this.validationPipe.transform(body, metatype);
                    }
                }
            }

            const resultValue = await handler(...args);

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');

            res.end(JSON.stringify(resultValue));
        } catch (error) {
            const errors = error as {
                property: string;
                constraints?: Record<string, string>;
            }[];

            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');

            const response = errors.map((error) => ({
                field: error.property,
                constraints: error.constraints,
            }));

            return res.end(JSON.stringify(response));
        }
    }

    private readBody(req: IncomingMessage): Promise<string> {
        return new Promise((resolve, reject) => {
            let body = '';

            req.on('data', (chunk) => {
                body += chunk;
            });

            req.on('end', () => {
                resolve(body);
            });

            req.on('error', reject);
        });
    }
}
