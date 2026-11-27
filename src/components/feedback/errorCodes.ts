import type { LucideIcon } from "lucide-react";
import { Ban, Clock, FileQuestion, KeyRound, Lock, ServerCrash, ShieldAlert, Unplug, Wrench, Hourglass } from "lucide-react";

export interface ErrorInfo {
  title: string;
  description: string;
  icon: LucideIcon;
  retry: boolean;
  tips: string[];
}

export const ERROR_CODES: Record<number, ErrorInfo> = {
  400: { title: "Something in the request was wrong", description: "The page got details it couldn't understand.", icon: Ban, retry: false,
    tips: ["Go back and check what you typed.", "If you used a saved link, open the page from the menu instead."] },
  401: { title: "Please sign in", description: "Your sign-in has expired or you are signed out.", icon: KeyRound, retry: false,
    tips: ["Sign in again. Bills already saved are not lost."] },
  403: { title: "You don't have access to this page", description: "Your role doesn't include this part of DailyKart.", icon: Lock, retry: false,
    tips: ["Ask the owner to give your role access on the Users page."] },
  404: { title: "Page not found", description: "This page doesn't exist or has moved.", icon: FileQuestion, retry: false,
    tips: ["Check the address, or pick the page from the menu."] },
  408: { title: "This took too long", description: "The server didn't answer in time.", icon: Clock, retry: true,
    tips: ["Check the shop's internet.", "Try again in a moment."] },
  429: { title: "Too many tries", description: "Too many requests were sent in a short time.", icon: Hourglass, retry: true,
    tips: ["Wait a minute, then try again."] },
  500: { title: "Something went wrong on our side", description: "The server ran into a problem.", icon: ServerCrash, retry: true,
    tips: ["Try again in a moment.", "If it keeps happening, tell the owner what you were doing."] },
  502: { title: "The server isn't answering properly", description: "A connection between services failed.", icon: Unplug, retry: true,
    tips: ["This is usually short. Try again in a minute."] },
  503: { title: "DailyKart is unavailable right now", description: "The service is busy or being updated.", icon: Wrench, retry: true,
    tips: ["Try again in a few minutes.", "Offline billing still works on devices that opened the app before."] },
  504: { title: "The server took too long to answer", description: "A service didn't reply in time.", icon: ShieldAlert, retry: true,
    tips: ["Check the internet and try again."] },
};

export const errorInfo = (code: number): ErrorInfo => ERROR_CODES[code] || ERROR_CODES[500];
