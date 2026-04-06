import { useState, useEffect } from "react";
import { Menu, User, LogOut, Camera, QrCode, Plus, BarChart3, Home, ArrowLeftRight, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { Link, useNavigate, useLocation } from "react-router-dom";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

export function Navbar() {
  const { user, profile, signOut, switchRole, isAdmin } = useAuth();
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem('theme');
    return savedTheme || 'light';
  });
  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
  };
  useEffect(() => {
    localStorage.setItem('theme', theme);
  }, [theme]);
  const navigate = useNavigate();
  const location = useLocation();

  const getInitials = (name?: string | null, email?: string) => {
    if (name) return name.charAt(0).toUpperCase();
    if (email) return email.charAt(0).toUpperCase();
    return "U";
  };

  const isActive = (path: string) => location.pathname.startsWith(path);

  return (
    <nav className="bg-primary text-primary-foreground shadow-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-14 sm:h-16">
          <Link to="/" className="flex items-center space-x-2">
            <Camera className="h-6 w-6" />
            <span className="text-xl sm:text-2xl font-bold">FaceTag</span>
          </Link>

          {/* Desktop nav links */}
          {user && (
            <div className="hidden md:flex items-center gap-1">
              {isAdmin ? (
                <>
                  <Link to="/admin/events">
                    <Button variant="ghost" size="sm" className={`text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-hover ${isActive("/admin/events") ? "bg-primary-hover text-primary-foreground" : ""}`}>
                      My Events
                    </Button>
                  </Link>
                  <Link to="/admin/create-event">
                    <Button variant="ghost" size="sm" className="text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-hover">
                      <Plus className="h-4 w-4 mr-1" />Create
                    </Button>
                  </Link>
                </>
              ) : (
                <Link to="/user/scan">
                  <Button variant="ghost" size="sm" className={`text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-hover ${isActive("/user/scan") ? "bg-primary-hover text-primary-foreground" : ""}`}>
                    <QrCode className="h-4 w-4 mr-1" />Scan QR
                  </Button>
                </Link>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            {/* Dark mode toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="text-primary-foreground hover:bg-white/10 rounded-full h-9 w-9"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark"
                ? <Sun className="h-5 w-5" />
                : <Moon className="h-5 w-5" />
              }
            </Button>
            {user ? (
              <>
                {/* User dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-primary-foreground hover:bg-primary-hover rounded-full">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="bg-primary-foreground/20 text-primary-foreground text-sm font-semibold">
                          {getInitials(profile?.display_name, profile?.email)}
                        </AvatarFallback>
                      </Avatar>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>
                      <div className="flex flex-col">
                        <span className="font-medium">{profile?.display_name || "User"}</span>
                        <span className="text-xs text-muted-foreground font-normal">{profile?.email}</span>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="gap-2 justify-between" onClick={() => { switchRole(); navigate(isAdmin ? "/user/scan" : "/admin/events"); }}>
                      <div className="flex items-center gap-2">
                        <ArrowLeftRight className="h-4 w-4" />
                        <span>Switch to {isAdmin ? "User" : "Admin"}</span>
                      </div>
                      <Badge variant="secondary" className="text-xs capitalize">{profile?.role}</Badge>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => { signOut(); navigate("/"); }} className="text-destructive focus:text-destructive gap-2">
                      <LogOut className="h-4 w-4" />Sign Out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Mobile menu */}
                <Sheet>
                  <SheetTrigger asChild>
                    <Button variant="ghost" size="icon" className="md:hidden text-primary-foreground hover:bg-primary-hover">
                      <Menu className="h-5 w-5" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent>
                    <SheetHeader>
                      <SheetTitle>Menu</SheetTitle>
                    </SheetHeader>
                    <nav className="mt-6 space-y-1">
                      <Link to="/">
                        <Button variant="ghost" className="w-full justify-start gap-2">
                          <Home className="h-4 w-4" />Home
                        </Button>
                      </Link>
                      {isAdmin ? (
                        <>
                          <Link to="/admin/events">
                            <Button variant="ghost" className="w-full justify-start gap-2">
                              <Camera className="h-4 w-4" />My Events
                            </Button>
                          </Link>
                          <Link to="/admin/create-event">
                            <Button variant="ghost" className="w-full justify-start gap-2">
                              <Plus className="h-4 w-4" />Create Event
                            </Button>
                          </Link>
                        </>
                      ) : (
                        <Link to="/user/scan">
                          <Button variant="ghost" className="w-full justify-start gap-2">
                            <QrCode className="h-4 w-4" />Scan QR Code
                          </Button>
                        </Link>
                      )}
                    </nav>
                  </SheetContent>
                </Sheet>
              </>
            ) : (
              <Link to="/auth">
                <Button variant="ghost" size="sm" className="text-primary-foreground hover:bg-primary-hover">
                  Sign In
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}