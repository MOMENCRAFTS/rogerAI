// ─── Roger AI — Centralized Icon Registry ───────────────────────────────────
// Maps typed icon names to Lucide React components.
// Every emoji in the codebase is replaced by a name from this map.
// Organized by domain for easy maintenance.

import {
  // Roger Modes
  VolumeX, Radio, Mic, MessageCircle, MessagesSquare, Zap,
  // PTT / Voice
  Volume2, Circle, Timer, Car,
  // Hazards
  Camera, Siren, AlertTriangle, Construction, Mountain, Waves, Ban,
  // Weather
  Sun, SunDim, CloudSun, Cloud, CloudFog, CloudDrizzle, CloudRain,
  CloudSnow, Snowflake, CloudLightning, Thermometer,
  // Smart Home (Tuya)
  Lightbulb, SunMedium, Palette, Plug, ToggleLeft, Lock, Flame,
  Eye, DoorOpen, Home, Fan, Wind, Droplets, Bot, Flower2, BarChart3,
  Package,
  // Service Graph
  Music, Calendar, FileText, TrendingUp, Plane, MapIcon, Link,
  Smartphone, User, Moon, Newspaper,
  // Service Status
  CheckCircle2, XCircle, CircleDashed, HelpCircle,
  // Academy / Gamification
  Star, Trophy, Gem, Medal, Crown, Target, Type, MessageSquare,
  // Flight
  Clock, PlaneLanding, Shuffle,
  // UI Status
  Check, X, Settings, Key,
  // Commute / Navigation
  ClipboardList, MapPin, Building2,
  // Misc
  Radar, RefreshCw, Mail, BookOpen, Brain, Shield, Pencil,
  PanelTopClose,
  type LucideIcon,
} from 'lucide-react';

// ─── Icon Map ────────────────────────────────────────────────────────────────

export const ICON_MAP: Record<string, LucideIcon> = {
  // ── Roger Modes ──────────────────────────────────────────────────────────
  'mode-quiet':       VolumeX,
  'mode-active':      Radio,
  'mode-briefing':    Mic,
  'mode-thoughtful':  MessageCircle,
  'mode-chatty':      MessagesSquare,
  'mode-always-on':   Zap,

  // ── PTT / Voice Pipeline ─────────────────────────────────────────────────
  'mic':              Mic,
  'speaker':          Volume2,
  'rec':              Circle,
  'timer':            Timer,
  'drive':            Car,

  // ── Hazard Radar ─────────────────────────────────────────────────────────
  'hazard-speedcam':  Camera,
  'hazard-police':    Siren,
  'hazard-accident':  AlertTriangle,
  'hazard-roadworks': Construction,
  'hazard-debris':    Mountain,
  'hazard-flood':     Waves,
  'hazard-closure':   Ban,

  // ── Weather (WMO) ────────────────────────────────────────────────────────
  'weather-clear':          Sun,
  'weather-mostly-clear':   SunDim,
  'weather-partly-cloudy':  CloudSun,
  'weather-overcast':       Cloud,
  'weather-fog':            CloudFog,
  'weather-drizzle':        CloudDrizzle,
  'weather-rain':           CloudRain,
  'weather-snow-light':     CloudSnow,
  'weather-snow':           Snowflake,
  'weather-storm':          CloudLightning,
  'weather-unknown':        Thermometer,

  // ── Smart Home (Tuya) ────────────────────────────────────────────────────
  'device-light':         Lightbulb,
  'device-dimmer':        SunMedium,
  'device-strip':         Palette,
  'device-plug':          Plug,
  'device-switch':        ToggleLeft,
  'device-breaker':       Zap,
  'device-ac':            Snowflake,
  'device-thermostat':    Thermometer,
  'device-curtain':       PanelTopClose,
  'device-lock':          Lock,
  'device-smoke':         Flame,
  'device-gas':           AlertTriangle,
  'device-motion':        Eye,
  'device-door':          DoorOpen,
  'device-camera':        Camera,
  'device-garage':        Home,
  'device-heater':        Flame,
  'device-fan':           Fan,
  'device-humidifier':    Wind,
  'device-dehumidifier':  Droplets,
  'device-vacuum':        Bot,
  'device-diffuser':      Flower2,
  'device-meter':         BarChart3,
  'device-gate':          Construction,
  'device-unknown':       Package,

  // ── Service Graph ────────────────────────────────────────────────────────
  'svc-spotify':     Music,
  'svc-radio':       Radio,
  'svc-gcal':        Calendar,
  'svc-tuya':        Home,
  'svc-notion':      FileText,
  'svc-finnhub':     TrendingUp,
  'svc-aviation':    Plane,
  'svc-maps':        MapIcon,
  'svc-openai':      Bot,
  'svc-whisper':     Mic,
  'svc-tts':         Volume2,
  'svc-supabase':    Link,
  'svc-twilio':      Smartphone,
  'svc-contacts':    User,
  'svc-islamic':     Moon,
  'svc-news':        Newspaper,

  // ── Service Status ───────────────────────────────────────────────────────
  'status-healthy':       CheckCircle2,
  'status-degraded':      AlertTriangle,
  'status-down':          XCircle,
  'status-unconfigured':  CircleDashed,
  'status-unknown':       HelpCircle,

  // ── Academy / Gamification ───────────────────────────────────────────────
  'badge-7day':      Flame,
  'badge-14day':     Star,
  'badge-30day':     Trophy,
  'badge-60day':     Gem,
  'badge-100day':    Medal,
  'badge-365day':    Crown,
  'badge-freeze':    Snowflake,
  'badge-cadet':     Target,
  'badge-fallback':  Target,
  'academy-vocab':   Type,
  'academy-drill':   Mic,
  'academy-conv':    MessageSquare,

  // ── Flight Status ────────────────────────────────────────────────────────
  'flight-scheduled':  Clock,
  'flight-active':     Plane,
  'flight-landed':     PlaneLanding,
  'flight-cancelled':  XCircle,
  'flight-incident':   AlertTriangle,
  'flight-diverted':   Shuffle,
  'flight-unknown':    HelpCircle,

  // ── UI Status Symbols ────────────────────────────────────────────────────
  'check':          Check,
  'x':              X,
  'warn':           AlertTriangle,
  'circle-empty':   Circle,
  'islamic':        Moon,
  'gear':           Settings,
  'key':            Key,
  'refresh':        RefreshCw,
  'pending':        Clock,

  // ── Commute / Navigation ─────────────────────────────────────────────────
  'car':            Car,
  'clipboard':      ClipboardList,
  'pin':            MapPin,
  'traffic':        AlertTriangle,
  'home':           Home,
  'office':         Building2,
  'map':            MapIcon,
  'radar':          Radar,

  // ── Misc ─────────────────────────────────────────────────────────────────
  'email':          Mail,
  'brain':          Brain,
  'memory':         BookOpen,
  'shield':         Shield,
  'note':           Pencil,
  'radio':          Radio,
  'channel':        Radio,
  'phone':          Smartphone,
  'lock':           Lock,
  'crown':          Crown,
  'star':           Star,
  'flame':          Flame,
};

// ─── Typed key helper ────────────────────────────────────────────────────────
export type RogerIconName = keyof typeof ICON_MAP;
