import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ErrorComponentProps } from "@tanstack/react-router";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

// Classic head script: parsed by Chromium 68 before any client modules run.
// Kept as text so none of its browser globals execute during SSR.
const legacyBrowserPolyfills = `(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  if (typeof globalThis === 'undefined') window.globalThis = window;
  if (typeof window.queueMicrotask !== 'function') {
    window.queueMicrotask = function (callback) {
      Promise.resolve().then(callback).catch(function (error) {
        setTimeout(function () { throw error; }, 0);
      });
    };
  }
  var MAX_LENGTH = 9007199254740991;
  function toLength(value) {
    var number = +value;
    if (number !== number || number <= 0) return 0;
    return Math.min(Math.floor(number), MAX_LENGTH);
  }
  function receiver(value) {
    if (value == null) throw new TypeError('Array receiver is null or undefined');
    return Object(value);
  }
  function speciesArray(source) {
    var constructor;
    if (Array.isArray(source)) {
      constructor = source.constructor;
      if (constructor && (typeof constructor === 'object' || typeof constructor === 'function')) {
        constructor = constructor[Symbol.species];
        if (constructor === null) constructor = undefined;
      }
    }
    return constructor === undefined ? [] : new constructor(0);
  }
  function flatten(target, source, length, depth, mapper, thisArg, index) {
    for (var i = 0; i < length; i++) {
      if (!(i in source)) continue;
      var element = source[i];
      if (mapper) element = mapper.call(thisArg, element, i, source);
      if (depth > 0 && Array.isArray(element)) {
        index = flatten(target, element, toLength(element.length), depth - 1, null, null, index);
      } else {
        if (index >= MAX_LENGTH) throw new TypeError('Flattened array is too large');
        Object.defineProperty(target, index++, { value: element, writable: true, enumerable: true, configurable: true });
      }
    }
    return index;
  }
  if (!Array.prototype.flat) Object.defineProperty(Array.prototype, 'flat', {
    configurable: true, writable: true,
    value: function flat() {
      var source = receiver(this), length = toLength(source.length);
      var depth = arguments[0] === undefined ? 1 : +arguments[0];
      depth = depth !== depth ? 0 : (depth < 0 ? Math.ceil(depth) : Math.floor(depth));
      var target = speciesArray(source);
      flatten(target, source, length, depth, null, null, 0);
      return target;
    }
  });
  if (!Array.prototype.flatMap) Object.defineProperty(Array.prototype, 'flatMap', {
    configurable: true, writable: true,
    value: function flatMap(callback) {
      var source = receiver(this), length = toLength(source.length);
      if (typeof callback !== 'function') throw new TypeError('flatMap callback must be a function');
      var target = speciesArray(source);
      flatten(target, source, length, 1, callback, arguments[1], 0);
      return target;
    }
  });
  if (Array.prototype[Symbol.unscopables]) {
    Array.prototype[Symbol.unscopables].flat = true;
    Array.prototype[Symbol.unscopables].flatMap = true;
  }
  if (!Array.prototype.at) Object.defineProperty(Array.prototype, 'at', {
    configurable: true, writable: true,
    value: function at(index) {
      var source = receiver(this), length = toLength(source.length);
      var number = +index;
      var integer = number !== number || number === 0 ? 0 : (number < 0 ? Math.ceil(number) : Math.floor(number));
      var actualIndex = integer >= 0 ? integer : length + integer;
      return actualIndex < 0 || actualIndex >= length ? undefined : source[actualIndex];
    }
  });
  if (!Object.fromEntries) Object.defineProperty(Object, 'fromEntries', {
    configurable: true, writable: true,
    value: function fromEntries(iterable) {
      if (iterable == null || typeof iterable[Symbol.iterator] !== 'function') throw new TypeError('Value is not iterable');
      var iterator = iterable[Symbol.iterator](), result = {}, step;
      try {
        while (true) {
          step = iterator.next();
          if (!step || typeof step !== 'object') throw new TypeError('Invalid iterator result');
          if (step.done) return result;
          var entry = step.value;
          if (entry === null || (typeof entry !== 'object' && typeof entry !== 'function')) throw new TypeError('Invalid entry');
          Object.defineProperty(result, entry[0], { value: entry[1], writable: true, enumerable: true, configurable: true });
        }
      } catch (error) {
        try { if (typeof iterator.return === 'function') iterator.return(); } catch (ignored) {}
        throw error;
      }
    }
  });
  if (!Object.hasOwn) Object.defineProperty(Object, 'hasOwn', {
    configurable: true, writable: true,
    value: function hasOwn(object, key) {
      if (object == null) throw new TypeError('Cannot convert undefined or null to object');
      return Object.prototype.hasOwnProperty.call(object, key);
    }
  });
  if (!String.prototype.replaceAll) Object.defineProperty(String.prototype, 'replaceAll', {
    configurable: true, writable: true,
    value: function replaceAll(searchValue, replaceValue) {
      if (this == null) throw new TypeError('String receiver is null or undefined');
      var string = String(this);
      var isRegExp = searchValue instanceof RegExp;
      if (typeof Symbol !== 'undefined' && Symbol.match && searchValue != null && searchValue[Symbol.match] !== undefined) {
        isRegExp = !!searchValue[Symbol.match];
      }
      if (isRegExp) {
        if (!searchValue.global) throw new TypeError('String.prototype.replaceAll called with a non-global RegExp argument');
        return String.prototype.replace.call(string, searchValue, replaceValue);
      }
      var searchString = String(searchValue);
      var escapedSearch = searchString.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
      return String.prototype.replace.call(string, new RegExp(escapedSearch, 'g'), replaceValue);
    }
  });
})();`;

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#1c1530" },
    ],
    scripts: [{ children: legacyBrowserPolyfills }],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@400;500;600;700&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  const isTvPage = useRouterState({ select: (state) => state.location.pathname === "/tv" });
  return (
    <html lang="pt-BR" data-tv-page={isTvPage ? "" : undefined}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster position="top-center" richColors />
    </QueryClientProvider>
  );
}
