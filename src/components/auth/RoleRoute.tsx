import { ReactNode } from "react";
import { useUserRole, type AppRole } from "@/hooks/useUserRole";

interface RoleRouteProps {
  allowedRoles: AppRole[];
  children: ReactNode;
}

function ForbiddenFallback() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl font-semibold">403 — Acesso negado</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Você não possui permissão para visualizar esta página. Se acredita que isso é um erro,
        fale com o administrador da organização.
      </p>
    </div>
  );
}

export function RoleRoute({ allowedRoles, children }: RoleRouteProps) {
  const { role, isLoading } = useUserRole();

  if (isLoading) return null;
  if (role === "no_access" || !allowedRoles.includes(role)) {
    return <ForbiddenFallback />;
  }

  return <>{children}</>;
}
