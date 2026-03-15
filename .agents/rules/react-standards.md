---
trigger: always_on
---

## React JS Coding Standards (2024-2025)

When writing or structuring React JS code, adhere to the following modern best practices:

1. **Functional Components & Hooks:** ALWAYS use functional components instead of class components. Utilize hooks (`useState`, `useEffect`, `useCallback`, `useMemo`) for state and lifecycle management. Build custom hooks for reusable logic to keep components lean (DRY principle).
2. **Performance Optimization:** 
   - Use `React.memo`, `useMemo`, and `useCallback` to prevent unnecessary re-renders.
   - Favor Server Components (React 19+) to reduce client-side JavaScript payload where applicable.
   - Implement code splitting and lazy loading for large applications.
3. **TypeScript First:** Prefer TypeScript over plain JavaScript for better type safety, self-documenting code, and early error detection.
4. **Clean Code & Structure:**
   - Use `PascalCase` for component names and short, descriptive file names.
   - Keep related components structured clearly and logically.
   - Avoid deeply nested render functions; break them into smaller subcomponents.
   - **Separation of Concerns:** Keep complex logic (custom hooks) and UI (JSX) in separate files when possible. For example, extract complex `useEffect` or state logic into a separate `useMyComponentLogic.ts` file, leaving the component file primarily for rendering JSX.
5. **State Management:** Keep state as close to the components that use it as possible. Avoid dumping everything into a global store. Use Context API for prop drilling issues, and only reach for Redux Toolkit or Zustand for complex, app-wide state.
6. **Effect Cleanup:** Always clean up side effects (like event listeners or timers) inside a `useEffect` return function to prevent memory leaks.

### Rules for Modifying React Code

When making modifications to existing React code, follow these specific constraints:
- **Do not refactor functional components into class components under any circumstances.**
- **Preserve Existing Patterns:** If a file uses specific state management (like Zustand or Context), do not introduce a new library (like Redux) for a single feature unless explicitly requested.
- **Limit Re-renders:** When adding new props or state, actively check if the change will cause unnecessary re-renders of child components. If it does, wrap the child in `React.memo` or use `useMemo` for the passed prop.
- **No Prop Drilling:** If you find yourself passing a prop down more than 3 levels during a modification, stop and implement a Context provider or refactor the component composition.
