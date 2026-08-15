import 'reflect-metadata';
import { Constructor } from './container';

type Route = {
    controller: Constructor;
    handler: string | symbol;
};

export class Router {
    public routes = new Map<string, Route>();

    constructor(private controllers: Constructor[]) {
        this.controllers.forEach((controller) => {
            const path = Reflect.getMetadata('path', controller);
            const routes = Reflect.getMetadata('routes', controller.prototype);

            routes.forEach((route: { method: string; path: string; handler: string | symbol }) => {
                const normalizedPath = route.path ? `/${path}/${route.path}` : `/${path}`;

                this.routes.set(`${route.method} ${normalizedPath}`, {
                    controller,
                    handler: route.handler,
                });
            });
        });
    }

    match(method: string, url: string) {
        for (const [path, route] of this.routes) {
            const [routeMethod, routePath] = path.split(' ');

            if (routeMethod !== method) {
                continue;
            }

            const routeParts = routePath.split('/');
            const urlParts = url.split('?')[0].split('/');

            if (routeParts.length !== urlParts.length) {
                continue;
            }

            const params: Record<string, string> = {};

            const matches = routeParts.every((part, index) => {
                if (part.startsWith(':')) {
                    const paramName = part.slice(1);
                    params[paramName] = urlParts[index];

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
