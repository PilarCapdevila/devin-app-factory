import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-lg font-semibold">Internal Tools</h1>
        <p className="mb-4 text-sm text-slate-600">Sign in with your work account.</p>
        <LoginForm />
      </div>
    </main>
  );
}
