import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import AdminEvents from "./pages/admin/Events";
import CreateEvent from "./pages/admin/CreateEvent";
import EventDetail from "./pages/admin/EventDetail";
import Analytics from "./pages/admin/Analytics";
import ScanQR from "./pages/user/ScanQR";
import Gallery from "./pages/Gallery";
import NotFound from "./pages/NotFound";
import { AIAssistant } from "./components/AIAssistant";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          
          {/* Admin routes */}
          <Route path="/admin/events" element={
            <ProtectedRoute requiredRole="admin">
              <AdminEvents />
            </ProtectedRoute>
          } />
          <Route path="/admin/create-event" element={
            <ProtectedRoute requiredRole="admin">
              <CreateEvent />
            </ProtectedRoute>
          } />
          <Route path="/admin/event/:eventId" element={
            <ProtectedRoute requiredRole="admin">
              <EventDetail />
            </ProtectedRoute>
          } />
          <Route path="/admin/event/:eventId/analytics" element={
            <ProtectedRoute requiredRole="admin">
              <Analytics />
            </ProtectedRoute>
          } />
          
          {/* User routes */}
          <Route path="/user/scan" element={
            <ProtectedRoute requireAuth>
              <ScanQR />
            </ProtectedRoute>
          } />
          
          {/* Public gallery routes - no auth required */}
          <Route path="/event/:eventId/:personId/:token" element={<Gallery />} />
          <Route path="/gallery/:qrCode" element={<Gallery />} />
          
          <Route path="*" element={<NotFound />} />
        </Routes>
        <AIAssistant />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
