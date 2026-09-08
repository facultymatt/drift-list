# Concept taxonomy

Coarse buckets for tagging decisions. Drawn from the React docs, the TypeScript
handbook, and common full-stack surface area. The point is consistent labels
across runs, not exhaustive coverage — tag with the closest bucket and put the
specific detail in the decision text.

If nothing here fits, use `other` and name the specific concept in the entry.

## React

- react-state — useState, useReducer, derived vs stored state, lifting state
- react-effects — useEffect, cleanup, dependency arrays, synchronization
- react-context — context, providers, prop drilling, when not to use it
- react-refs — useRef, imperative handles, DOM access
- react-performance — memo, useMemo, useCallback, re-render behavior, virtualization
- react-portals — portals, modals, dialogs, focus management, z-index escape
- react-suspense — suspense, lazy, transitions, streaming, error boundaries
- react-data-flow — data fetching, cache, mutation, server state
- react-forms — controlled vs uncontrolled, validation, form state
- react-composition — component boundaries, children, render props, custom hooks
- react-server — server components, SSR, hydration

## TypeScript

- ts-basic-types — primitives, arrays, objects, inference, annotations
- ts-unions — union and intersection types, narrowing, discriminated unions
- ts-generics — generic functions and types, constraints, inference
- ts-type-operators — keyof, typeof, indexed access, conditional, mapped types
- ts-functions — signatures, overloads, this typing, parameter variance
- ts-classes — classes, interfaces, implements, abstract, access modifiers
- ts-modules — imports, exports, declaration files, module resolution
- ts-nullability — strict null checks, optional chaining, assertions
- ts-enums — enums, const enums, literal unions as alternatives

## Async and concurrency

- async-promises — promises, async/await, Promise.all / allSettled / race
- async-errors — error propagation, partial failure, retry, backoff
- async-scheduling — debounce, throttle, cancellation, abort signals
- async-streams — streaming, backpressure, iterators, generators

## Data and storage

- data-modeling — schema design, normalization, derived vs stored fields
- data-serialization — JSON, JSONL, encoding, parsing, malformed input
- data-storage — file system, database choice, caching, invalidation
- data-querying — filtering, sorting, pagination, indexing

## APIs and services

- api-design — endpoint shape, request/response contracts, versioning
- api-integration — SDK usage, auth, rate limits, token budgets, timeouts
- api-messaging — queues, pub/sub, acknowledgment, delivery semantics

## Frontend rendering

- rendering-layout — CSS layout, positioning, overflow, responsive behavior
- rendering-graphics — canvas, WebGL, shaders, Three.js, coordinate spaces
- rendering-tables — grids, cell renderers, virtualization, large data sets
- rendering-interaction — events, keyboard, focus, accessibility

## Tooling and infrastructure

- tooling-build — bundlers, transpilation, module formats, dependency versions
- tooling-cli — argument parsing, output, exit codes, ergonomics
- tooling-testing — test structure, assertions, fixtures, coverage
- tooling-deploy — containers, environment config, secrets, CI

## Cross-cutting

- error-handling — failure modes, recovery, logging, user-facing errors
- time-handling — timestamps, time zones, DST, durations, windows
- cross-platform — path handling, line endings, OS differences, encoding
- code-organization — module boundaries, duplication, shared utilities
- prompt-engineering — prompt structure, structured output, model selection
