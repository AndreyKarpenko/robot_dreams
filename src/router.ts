import 'reflect-metadata';

type Route = {
    controller: Function;
    handler: string | symbol;
};

export class Router {
    public routes = new Map<string, Route>();

    constructor(private controllers: Function[]) {
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
}
