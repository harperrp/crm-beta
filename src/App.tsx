import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/providers/AuthProvider";
import { OrgProvider } from "@/providers/OrgProvider";
import { AppShell } from "@/components/layout/AppShell";
import { LandingPage } from "@/pages/LandingPage";
import { DashboardPage } from "@/pages/Dashboard";
import { LeadsPage } from "@/pages/Leads";
import { ContractsCrudPage } from "@/pages/ContractsCrud";
import { MapViewPage } from "@/pages/MapView";
import { FinancialPage } from "@/pages/Financial";
import { ContactsPage } from "@/pages/Contacts";
import { ArtistCalendarPage } from "@/components/artist-calendar/ArtistCalendarPage";
import { TeamPage } from "@/pages/Team";
import { TasksPage } from "@/pages/Tasks";
import { UsersPage } from "@/pages/Users";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { RoleRoute } from "@/components/auth/RoleRoute";
import { ArtistDashboardPage } from "@/pages/ArtistDashboard";
import { SuperAdminPage } from "@/pages/SuperAdmin";
import { WhatsAppInboxPage } from "@/pages/WhatsAppInbox";


const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <OrgProvider>
          <BrowserRouter>
            <Routes>
              {/* Landing Page */}
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<Login />} />

              {/* Protected App Routes */}
              {/* RLS in Supabase remains the primary data security layer; RoleRoute is UX + defense-in-depth. */}
              <Route element={<ProtectedRoute />}>
                <Route path="/app" element={<AppShell />}>
                  <Route index element={<DashboardPage />} />
                  <Route path="dashboard" element={<DashboardPage />} />
                  <Route
                    path="artist"
                    element={
                      <RoleRoute allowedRoles={["artista"]}>
                        <ArtistDashboardPage />
                      </RoleRoute>
                    }
                  />
                  <Route
                    path="calendar"
                    element={
                      <RoleRoute allowedRoles={["artista"]}>
                        <ArtistCalendarPage />
                      </RoleRoute>
                    }
                  />
                  <Route
                    path="leads"
                    element={
                      <RoleRoute allowedRoles={["comercial", "financeiro", "admin"]}>
                        <LeadsPage />
                      </RoleRoute>
                    }
                  />
                  <Route
                    path="whatsapp"
                    element={
                      <RoleRoute allowedRoles={["comercial", "financeiro", "admin"]}>
                        <WhatsAppInboxPage />
                      </RoleRoute>
                    }
                  />
                  <Route
                    path="contracts"
                    element={
                      <RoleRoute allowedRoles={["comercial", "financeiro", "admin"]}>
                        <ContractsCrudPage />
                      </RoleRoute>
                    }
                  />
                  <Route
                    path="contacts"
                    element={
                      <RoleRoute allowedRoles={["comercial", "financeiro", "admin"]}>
                        <ContactsPage />
                      </RoleRoute>
                    }
                  />
                  <Route
                    path="tasks"
                    element={
                      <RoleRoute allowedRoles={["artista"]}>
                        <TasksPage />
                      </RoleRoute>
                    }
                  />
                  <Route
                    path="team"
                    element={
                      <RoleRoute allowedRoles={["admin"]}>
                        <TeamPage />
                      </RoleRoute>
                    }
                  />
                  <Route
                    path="users"
                    element={
                      <RoleRoute allowedRoles={["admin"]}>
                        <UsersPage />
                      </RoleRoute>
                    }
                  />
                  <Route path="map" element={<MapViewPage />} />
                  <Route
                    path="financial"
                    element={
                      <RoleRoute allowedRoles={["financeiro", "admin"]}>
                        <FinancialPage />
                      </RoleRoute>
                    }
                  />
                  <Route
                    path="admin"
                    element={
                      <RoleRoute allowedRoles={["admin"]}>
                        <SuperAdminPage />
                      </RoleRoute>
                    }
                  />
                </Route>
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </OrgProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
