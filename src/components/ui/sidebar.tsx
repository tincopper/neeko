import * as React from "react";
import { cn } from "../../utils/cn";
import { useSidebar } from "../../context/sidebar-context";

// --- Sidebar (layout container) ---

interface SidebarProps extends React.ComponentProps<"div"> {
  variant?: "icon" | "panel";
}

function Sidebar({ variant, className, children, ...props }: SidebarProps) {
  if (variant === "icon") {
    return (
      <div
        className={cn(
          "w-12 shrink-0 flex flex-col bg-bg-secondary",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }

  if (variant === "panel") {
    const { onPanelResizeStart } = useSidebar();
    return (
      <div
        className={cn(
          "relative flex flex-col shrink-0 bg-bg-secondary overflow-hidden",
          className
        )}
        {...props}
      >
        {children}
        <div
          className="absolute top-0 right-[-3px] w-1.5 h-full cursor-col-resize z-10 hover:bg-white/20 active:bg-white/20"
          onMouseDown={onPanelResizeStart}
        />
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col", className)} {...props}>
      {children}
    </div>
  );
}

// --- SidebarHeader ---

function SidebarHeader({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("border-b border-border", className)} {...props}>
      {children}
    </div>
  );
}

// --- SidebarContent ---

function SidebarContent({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex-1 overflow-y-auto", className)} {...props}>
      {children}
    </div>
  );
}

// --- SidebarFooter ---

function SidebarFooter({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn(className)} {...props}>
      {children}
    </div>
  );
}

// --- SidebarMenu ---

function SidebarMenu({ className, children, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul className={cn("flex flex-col gap-0.5 w-full", className)} {...props}>
      {children}
    </ul>
  );
}

// --- SidebarMenuItem ---

function SidebarMenuItem({ className, children, ...props }: React.ComponentProps<"li">) {
  return (
    <li className={cn("list-none", className)} {...props}>
      {children}
    </li>
  );
}

// --- SidebarMenuButton ---

interface SidebarMenuButtonProps extends React.ComponentProps<"button"> {
  isActive?: boolean;
  tooltip?: string;
}

function SidebarMenuButton({ isActive, tooltip, className, children, ...props }: SidebarMenuButtonProps) {
  return (
    <button
      title={tooltip}
      className={cn(
      "relative w-full h-12 flex items-center justify-center",
      "transition-colors duration-150 focus:outline-none",
      isActive
        ? [
            "text-text-primary",
            "before:absolute before:left-0 before:top-2 before:bottom-2",
            "before:w-0.5 before:bg-white before:rounded-r",
          ]
        : "text-text-secondary hover:text-text-primary hover:bg-bg-hover",
      className
      )}      {...props}
    >
      {children}
    </button>
  );
}

export { Sidebar, SidebarHeader, SidebarContent, SidebarFooter, SidebarMenu, SidebarMenuItem, SidebarMenuButton };
