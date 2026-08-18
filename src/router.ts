import 'reflect-metadata';
import { Constructor } from './container';
import { RouteDefinition } from './decorators';

type Route = {
    controller: Constructor;
    handler: string | symbol;
};

export type MatchedRoute = {
    route: Route;
    params: Record<string, string>;
};

function joinPath(prefix: string, path = ''): string {
    const joined = [prefix, path].join('/').split('/').filter(Boolean).join('/');

    return `/${joined}`;
}

export class Router {
    public routes = new Map<string, Route>();

    constructor(private controllers: Constructor[]) {
        this.controllers.forEach((controller) => {
            const prefix = Reflect.getMetadata('path', controller) ?? '';
            const routes: RouteDefinition[] =
                Reflect.getMetadata('routes', controller.prototype) ?? [];

            routes.forEach((route) => {
                const fullPath = joinPath(prefix, route.path);

                this.routes.set(`${route.method} ${fullPath}`, {
                    controller,
                    handler: route.handler,
                });
            });
        });
    }

    match(method: string, url: string): MatchedRoute | undefined {
        const pathname = url.split('?')[0];
        const exactRoute = this.routes.get(`${method} ${pathname}`);

        if (exactRoute) {
            return {
                route: exactRoute,
                params: {},
            };
        }

        for (const [path, route] of this.routes) {
            const [routeMethod, routePath] = path.split(' ');

            if (routeMethod !== method) {
                continue;
            }

            const routeParts = routePath.split('/');
            const urlParts = pathname.split('/');

            if (routeParts.length !== urlParts.length) {
                continue;
            }

            const params: Record<string, string> = {};

            const matches = routeParts.every((part, index) => {
                if (part.startsWith(':')) {
                    params[part.slice(1)] = decodeURIComponent(urlParts[index]);
                    return true;
                }

                return part === urlParts[index];
            });

            if (matches) {
                return {
                    route,
                    params,
                };
            }
        }

        return undefined;
    }
}
