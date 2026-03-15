## Node.js Coding Standards (2024-2025)

When writing or structuring Node.js backend code, adhere to the following modern best practices:

1. **Architecture & Structure:**
   - **Layered Architecture:** Separate the application cleanly into Controllers (handling HTTP requests/responses), Services (core business logic), and Data Access (Models/ORMs/Database queries).
   - **Modular Code:** Follow the Single Responsibility Principle (SRP). Keep files small and focused on a single functionality.
   - **Project Layout:** Use a clear directory structure such as `src/config`, `src/controllers`, `src/routes`, `src/services`, `src/models`, `src/middlewares`, and `src/utils`.

2. **Asynchronous Programming:**
   - ALWAYS use `async/await` instead of chaining Promises (`.then()/.catch()`) or using callbacks. This ensures better readability and stack trace clarity.
   - Avoid blocking the Event Loop. Use `Promise.all()` to execute independent async operations concurrently.

3. **TypeScript First (If configured):**
   - Prefer TypeScript over core JavaScript to provide static typing, better self-documentation, and early bug detection.
   - Define explicit `Interfaces` or `Types` for request payloads, response bodies, and database models. Avoid using `any`.

4. **Error Handling & Validation:**
   - **Centralized Error Handling:** Use a global error-handling middleware (if using Express/Fastify) rather than scattering varied `res.status().send()` calls everywhere.
   - **Request Validation:** Validate all incoming requests (body, query, parameters) at the route/middleware level using libraries like **Zod** or **Joi** before they reach the controller.
   - **Custom Errors:** Throw custom AppError classes (e.g., `ValidationError`, `UnauthorizedError`) with appropriate HTTP status codes for predictable responses.

5. **Security & Configuration:**
   - **Environment Variables:** Never hardcode secrets. Use `.env` files and a central `config` file to validate and export environment variables across the app.
   - **Standard Security Middleware:** Use tools like `helmet` for HTTP headers, apply rate-limiting, and sanitize inputs to prevent injection attacks.
   - **Stateless APIs:** Keep the API stateless (e.g., JWT-based auth) to enable easy horizontal scaling without dealing with sticky sessions.

6. **Clean Code & Conventions:**
   - Use `camelCase` for functions and variables, `PascalCase` for classes and models, and `UPPER_SNAKE_CASE` for global constant values.
   - Extract "Magic Numbers" and hardcoded "Magic Strings" into a `constants/` file.
   - Keep functions small (ideally fitting on a single screen) and use early returns to avoid deep nesting of `if/else` statements.

### Rules for Modifying Node.js Code

When making modifications to existing Node.js code, follow these constraints:
- **Maintain Existing Architecture:** If the codebase uses a specific pattern (like Dependency Injection, a Router-Controller-Service pattern, or a specific ORM like Prisma), strictly adhere to it when adding new features.
- **Do not introduce blocking operations:** Be vigilant not to introduce synchronous methods (e.g., `fs.readFileSync`) inside route handlers, as it will block the entire Node.js single thread.
- **Graceful Shutdown:** When modifying server startup logic, ensure you maintain gracefully closing database connections and active processes on `SIGINT` or `SIGTERM`.
