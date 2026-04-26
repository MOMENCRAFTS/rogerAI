/**
 * en.ts — English UI translation dictionary (source of truth).
 *
 * All other language dictionaries (ar.ts, fr.ts, es.ts) are generated
 * from this file using the ChatGPT translation pipeline.
 *
 * Key naming convention: component_section_element
 * Placeholders use {curly} syntax: "Welcome, {name}"
 */

import type { TranslationDict } from '../i18n';

const en: TranslationDict = {

  // ══════════════════════════════════════════════════════════════
  // GLOBAL / SHARED
  // ══════════════════════════════════════════════════════════════
  'app.name': 'ROGER AI',
  'app.tagline': 'CHIEF OF STAFF',
  'app.initialising': 'Initialising...',
  'app.loading': 'Loading...',
  'app.error': 'Something went wrong',
  'app.retry': 'Retry',
  'app.cancel': 'Cancel',
  'app.save': 'Save',
  'app.delete': 'Delete',
  'app.confirm': 'Confirm',
  'app.done': 'Done',
  'app.close': 'Close',
  'app.back': 'Back',
  'app.next': 'Next',
  'app.prev': 'Prev',
  'app.skip': 'Skip',
  'app.yes': 'Yes',
  'app.no': 'No',
  'app.on': 'ON',
  'app.off': 'OFF',
  'app.live': 'LIVE',
  'app.no_gps': 'NO GPS',
  'app.gps_live': 'GPS LIVE',
  'app.connected': 'Connected',
  'app.not_connected': 'Not connected',
  'app.connect': 'Connect',
  'app.disconnect': 'Disconnect',

  // ══════════════════════════════════════════════════════════════
  // NAV — Bottom tab bar (UserApp.tsx)
  // ══════════════════════════════════════════════════════════════
  'nav.home': 'HOME',
  'nav.remind': 'REMIND',
  'nav.tasks': 'TASKS',
  'nav.memory': 'MEMORY',
  'nav.meetings': 'MEETINGS',
  'nav.journal': 'JOURNAL',
  'nav.stats': 'STATS',
  'nav.locate': 'LOCATE',
  'nav.drive': 'DRIVE',
  'nav.upgrade': 'UPGRADE',
  'nav.salah': 'SALAH',
  'nav.iot': 'IOT',
  'nav.settings': 'SETTINGS',
  'nav.modules': 'MODULES',
  'nav.academy': 'ACADEMY',

  // ══════════════════════════════════════════════════════════════
  // PTT — Push to Talk (UserHome.tsx)
  // ══════════════════════════════════════════════════════════════
  'ptt.hold_to_talk': 'HOLD TO TALK',
  'ptt.recording': '● REC',
  'ptt.recording_time': '● REC {time}s',
  'ptt.release_to_send': 'Release to send',
  'ptt.listening': 'LISTENING...',
  'ptt.thinking': 'ROGER IS THINKING...',
  'ptt.processing': 'PROCESSING...',
  'ptt.speaking': 'ROGER IS SPEAKING',
  'ptt.standing_by': 'Standing by',
  'ptt.tap_to_stop': 'Tap to stop',
  'ptt.hold_longer': 'Hold a bit longer and speak clearly',
  'ptt.error_mic': 'Microphone error — check permissions',
  'ptt.error_transcribe': 'Could not transcribe — try again',
  'ptt.error_process': 'Processing error — try again',
  'ptt.over': 'Over.',

  // ══════════════════════════════════════════════════════════════
  // HOME — UserHome header & status
  // ══════════════════════════════════════════════════════════════
  'home.greeting_morning': 'Good morning, {name}',
  'home.greeting_afternoon': 'Good afternoon, {name}',
  'home.greeting_evening': 'Good evening, {name}',
  'home.status_ready': 'Ready for commands',
  'home.status_offline': 'Offline',

  // ══════════════════════════════════════════════════════════════
  // BRIEFING — Morning/Afternoon/Evening (MorningBriefing.tsx)
  // ══════════════════════════════════════════════════════════════
  'briefing.morning': 'Morning Briefing',
  'briefing.afternoon': 'Afternoon Brief',
  'briefing.evening': 'Evening Debrief',
  'briefing.request': 'Request Briefing from Roger',
  'briefing.compiling': 'Compiling briefing...',
  'briefing.dismiss': 'Dismiss',

  // ══════════════════════════════════════════════════════════════
  // REMINDERS (RemindersView.tsx)
  // ══════════════════════════════════════════════════════════════
  'reminders.title': 'REMINDERS',
  'reminders.tab_active': 'Active',
  'reminders.tab_completed': 'Completed',
  'reminders.empty': 'No reminders yet — say "remind me to..."',
  'reminders.empty_completed': 'No completed reminders',
  'reminders.due': 'Due',
  'reminders.completed': 'Completed',
  'reminders.dismiss': 'Dismiss',
  'reminders.complete': 'Complete',
  'reminders.geo_trigger': 'Near {location}',
  'reminders.overdue': 'OVERDUE',

  // ══════════════════════════════════════════════════════════════
  // TASKS (TasksView.tsx)
  // ══════════════════════════════════════════════════════════════
  'tasks.title': 'TASKS',
  'tasks.tab_open': 'Open',
  'tasks.tab_done': 'Done',
  'tasks.empty': 'No tasks — say "add task..."',
  'tasks.empty_done': 'No completed tasks',
  'tasks.priority': 'P{level}',
  'tasks.complete': 'Complete',
  'tasks.delete': 'Delete',
  'tasks.proposed': 'Proposed by Roger',

  // ══════════════════════════════════════════════════════════════
  // MEMORY (MemoryView.tsx)
  // ══════════════════════════════════════════════════════════════
  'memory.title': 'MEMORY GRAPH',
  'memory.search_placeholder': 'Search memories...',
  'memory.empty': 'No memories yet',
  'memory.no_results': 'No results found',
  'memory.sources': 'Sources',
  'memory.created': 'Created',
  'memory.updated': 'Updated',
  'memory.confirmed': 'Confirmed',
  'memory.draft': 'Draft',
  'memory.category_all': 'All',
  'memory.fact_count': '{count} facts',

  // ══════════════════════════════════════════════════════════════
  // JOURNAL (JournalView.tsx)
  // ══════════════════════════════════════════════════════════════
  'journal.title': 'JOURNAL',
  'journal.search_placeholder': 'Search entries...',
  'journal.empty': 'No entries yet',
  'journal.no_results': 'No matching entries',
  'journal.entry_count': '{count} entries',

  // ══════════════════════════════════════════════════════════════
  // ANALYTICS (UserAnalytics.tsx)
  // ══════════════════════════════════════════════════════════════
  'analytics.title': 'ANALYTICS',
  'analytics.transmissions': 'Transmissions',
  'analytics.tokens_used': 'Tokens Used',
  'analytics.response_time': 'Response Time',
  'analytics.period_today': 'Today',
  'analytics.period_week': 'Week',
  'analytics.period_month': 'Month',
  'analytics.period_all': 'All Time',
  'analytics.streak': 'Streak',
  'analytics.days': '{count} days',
  'analytics.avg': 'AVG',
  'analytics.total': 'TOTAL',
  'analytics.digest': 'AI Digest',
  'analytics.top_intents': 'Top Intents',
  'analytics.usage_chart': 'Usage Over Time',

  // ══════════════════════════════════════════════════════════════
  // MEETING RECORDER (MeetingRecorderView.tsx)
  // ══════════════════════════════════════════════════════════════
  'meeting.title': 'MEETING RECORDER',
  'meeting.state_ready': 'Ready',
  'meeting.state_recording': 'Recording',
  'meeting.state_processing': 'Processing',
  'meeting.state_complete': 'Complete',
  'meeting.start': 'Start Recording',
  'meeting.stop': 'Stop',
  'meeting.pause': 'Pause',
  'meeting.resume': 'Resume',
  'meeting.summary': 'Summary',
  'meeting.action_items': 'Action Items',
  'meeting.transcript': 'Transcript',
  'meeting.duration': 'Duration',
  'meeting.empty': 'No meetings recorded yet',

  // ══════════════════════════════════════════════════════════════
  // LOCATION (LocationView.tsx)
  // ══════════════════════════════════════════════════════════════
  'location.title': 'Location Intel',
  'location.current_position': 'Current Position',
  'location.weather_now': 'Weather Now',
  'location.commute_eta': 'Commute ETA',
  'location.geo_reminders': 'Geo Reminders',
  'location.place_memories': 'Place-Tagged Memories',
  'location.awaiting_gps': 'Awaiting GPS signal',
  'location.fetching_weather': 'Fetching weather...',
  'location.calculating_routes': 'Calculating routes...',
  'location.weather_unavailable': 'Weather unavailable',
  'location.mode_driving': 'Driving',
  'location.mode_transit': 'Transit',
  'location.mode_walking': 'Walking',
  'location.no_geo_reminders': 'No geo reminders set',
  'location.no_place_memories': 'No place-tagged memories',

  // ══════════════════════════════════════════════════════════════
  // SALAH / ISLAMIC MODE (SalahView.tsx)
  // ══════════════════════════════════════════════════════════════
  'salah.title': 'Salah',
  'salah.prayer_times': "Today's Prayer Times",
  'salah.qibla': 'Qibla Direction',
  'salah.verse': 'Verse of the Day',
  'salah.tracker': "Today's Tracker",
  'salah.loading': 'Loading prayer times…',
  'salah.error': 'Could not load prayer times',
  'salah.no_location': 'Location unavailable — using Riyadh',
  'salah.compass_active': 'Compass active — hold phone flat',
  'salah.compass_unavailable': 'Device compass not available',
  'salah.next_prayer': 'NEXT',
  'salah.footer': 'Powered by UmmahAPI.com · Change in Settings',
  'salah.prayed': 'Prayed',
  'salah.missed': 'Missed',
  'salah.hadith': 'Hadith of the Day',
  'salah.dua': 'Dua of the Day',
  'salah.name_of_allah': 'Name of Allah',
  'salah.hijri_date': 'Hijri Date',
  'salah.listen': 'Listen',
  'salah.read_full': 'Read full hadith',

  // ══════════════════════════════════════════════════════════════
  // SMART HOME (SmartHomeView.tsx)
  // ══════════════════════════════════════════════════════════════
  'smarthome.title': 'Smart Home',
  'smarthome.devices': 'DEVICES',
  'smarthome.online': 'ONLINE',
  'smarthome.active': 'ACTIVE',
  'smarthome.offline': 'OFFLINE',
  'smarthome.tab_devices': 'Devices',
  'smarthome.tab_scenes': 'Scenes',
  'smarthome.no_devices': 'No devices found',
  'smarthome.no_scenes': 'No scenes found',
  'smarthome.executing': 'Executing...',
  'smarthome.tap_to_run': 'Tap-to-run scene',
  'smarthome.voice_hint': 'Say "turn on the living room lights" or "run movie mode"',
  'smarthome.setup_title': 'Setup Smart Home',
  'smarthome.setup_step1': 'Go to Settings → Smart Home',
  'smarthome.setup_step2': 'Enter your Tuya credentials',
  'smarthome.setup_step3': 'Link your devices',
  'smarthome.setup_step4': 'Control with voice',

  // ══════════════════════════════════════════════════════════════
  // COMMUTE RADAR (CommuteRadar.tsx)
  // ══════════════════════════════════════════════════════════════
  'commute.title': 'COMMUTE COMMAND',
  'commute.tab_radar': '◎ RADAR',
  'commute.tab_route': '🗺 ROUTE',
  'commute.speed_unit': 'km/h',
  'commute.exit': 'EXIT',
  'commute.brief': '🚦 BRIEF',
  'commute.route_intel': 'ROUTE INTEL',
  'commute.calculating_eta': 'Calculating ETA...',
  'commute.no_route': 'No route set — say "My work is at..."',
  'commute.errands_pending': 'ERRANDS · {count} PENDING',

  // ══════════════════════════════════════════════════════════════
  // RADAR (RadarView.tsx)
  // ══════════════════════════════════════════════════════════════
  'radar.title': 'ROGER RADAR',
  'radar.subtitle': 'UNIFIED HAZARD LAYER',
  'radar.scanning': 'SCANNING...',
  'radar.zone_clear': 'ZONE CLEAR',
  'radar.gps_required': 'GPS REQUIRED',
  'radar.report_hazard': '📡 REPORT HAZARD',
  'radar.mute_zone': '🔊 MUTE ZONE',
  'radar.muted': '🔇 MUTED',
  'radar.thank_roger': 'THANK ROGER',
  'radar.not_there': 'NOT THERE',
  'radar.confirm_report': 'CONFIRM HAZARD REPORT',
  'radar.broadcasting': 'BROADCASTING...',
  'radar.merged': '✓ MERGE & BROADCAST',
  'radar.position_confirmed': 'POSITION CONFIRMED',
  'radar.approaching': 'APPROACHING',
  'radar.confirmed_by': 'CONFIRMED BY {count} USERS',
  'radar.voice_alert_sent': 'VOICE ALERT SENT',
  'radar.gps_required_report': 'GPS REQUIRED TO REPORT',
  'radar.sector_intel': 'SECTOR INTEL · {count} ACTIVE',
  'radar.multi_source': '✓ MULTI-SOURCE',
  'radar.position_unknown': 'POSITION UNKNOWN',

  // ══════════════════════════════════════════════════════════════
  // SUBSCRIPTION (SubscriptionView.tsx)
  // ══════════════════════════════════════════════════════════════
  'sub.title': 'Subscription',
  'sub.free_name': 'ROGER FREE',
  'sub.pro_name': 'ROGER PRO',
  'sub.command_name': 'ROGER COMMAND',
  'sub.most_popular': 'MOST POPULAR',
  'sub.teams': 'TEAMS',
  'sub.current_plan': 'Current Plan',
  'sub.today_usage': "Today's Usage",
  'sub.ptt_transmissions': 'PTT Transmissions',
  'sub.start_trial': 'Start 7-Day Free Trial →',
  'sub.contact_us': 'Contact Us →',
  'sub.current_badge': '● Current Plan',
  'sub.monthly': 'monthly',
  'sub.annual': 'annual',
  'sub.save_percent': 'Save {percent}%',
  'sub.islamic_free': 'Islamic Mode — always free',
  'sub.stripe_coming': 'Stripe payment integration coming soon',
  // Feature lists
  'sub.free_f1': '10 PTT transmissions/day',
  'sub.free_f2': 'Basic memory graph',
  'sub.free_f3': 'Morning briefing',
  'sub.free_f4': 'Reminders & tasks',
  'sub.free_f5': 'Islamic mode (Salah, Qibla, Quran)',
  'sub.free_f6': 'Community hazard reports',
  'sub.free_f7': 'PTT Network (relay messaging)',
  'sub.free_f8': 'Smart Home voice control',
  'sub.pro_f1': '100 PTT transmissions/day',
  'sub.pro_f2': 'GPT-5.5 full quality responses',
  'sub.pro_f3': 'Advanced memory graph + insights',
  'sub.pro_f4': 'Proactive check-ins',
  'sub.pro_f5': 'Meeting recorder + AI notes',
  'sub.pro_f6': 'Google Calendar integration',
  'sub.pro_f7': 'Spotify voice control',
  'sub.pro_f8': 'Finance & flight tracking',
  'sub.pro_f9': 'Journal + analytics',
  'sub.pro_f10': 'Notion integration',
  'sub.pro_f11': 'Commute radar + route intel',
  'sub.pro_f12': 'Priority support',
  'sub.pro_f13': 'Tune In (P2P voice sessions)',

  // ══════════════════════════════════════════════════════════════
  // ORIENTATION (Orientation.tsx)
  // ══════════════════════════════════════════════════════════════
  'orientation.header': 'Roger AI · Orientation',
  'orientation.hold_say': 'Hold and say "understood"',
  'orientation.rec': '● REC',
  'orientation.rec_time': '● REC {time}s — release when done',
  'orientation.listening': 'Listening...',
  'orientation.copy_that': '✓ Copy that',
  'orientation.continue': 'Continue →',
  'orientation.didnt_catch': "Didn't catch that — try again or tap Continue",
  'orientation.could_not_hear': 'Could not hear you — tap Continue below',
  'orientation.prev': 'Prev',
  'orientation.skip': 'Skip →',
  'orientation.ptt_engage': '● Engage via PTT',
  'orientation.ptt_advance': '● PTT to advance',
  'orientation.version': 'Orientation v{version} · Roger AI',
  'orientation.voice_examples': 'Voice Examples',

  // ══════════════════════════════════════════════════════════════
  // SETTINGS (RogerSettings.tsx)
  // ══════════════════════════════════════════════════════════════
  'settings.title': 'Settings',
  'settings.profile': 'Profile & Personalization',
  'settings.behavior': 'Behavior',
  'settings.integrations': 'Integrations',
  'settings.danger_zone': 'Danger Zone',
  'settings.language': 'Language',
  'settings.change_language': 'Change Language',
  'settings.change_language_warning': 'Changing language will restart the app',
  'settings.response_mode': 'Response Mode',
  'settings.response_full': 'Full',
  'settings.response_quick': 'Quick',
  'settings.proactive_checkins': 'Proactive Check-ins',
  'settings.islamic_mode': 'Islamic Mode',
  'settings.quick_mode': 'Quick Mode',
  'settings.haptics': 'Haptic Feedback',
  'settings.sound_effects': 'Sound Effects',
  'settings.display_name': 'Display Name',
  'settings.save_name': 'Save',
  // Integrations
  'settings.google_calendar': 'Google Calendar',
  'settings.finnhub': 'Finnhub Finance',
  'settings.flight_tracking': 'Flight Tracking',
  'settings.twilio_sms': 'Twilio SMS',
  'settings.spotify': 'Spotify',
  'settings.notion': 'Notion',
  'settings.tuya': 'Tuya Smart Home',
  // Factory Reset
  'settings.factory_reset': 'Factory Reset',
  'settings.reset_warning': 'This will erase all your data, memories, settings, and conversations. This action cannot be undone.',
  'settings.reset_confirm_label': 'Type RESET to confirm',
  'settings.reset_button': 'RESET MY ROGER',
  'settings.reset_final': 'Final Confirmation',
  'settings.reset_erase': 'Erase Everything',
  'settings.resetting': 'Resetting...',
  // Prayer settings
  'settings.prayer_method': 'Calculation Method',
  'settings.prayer_school': 'Juristic School',
  'settings.voice_commands': 'Voice Commands',
  'settings.voice_commands_hint': 'Say "Islamic mode on" or "What time is Fajr?"',
  'settings.sign_out': 'Sign Out',
  'settings.location_awareness': 'Location Awareness',
  'settings.notifications': 'Notifications',
  'settings.contacts': 'Contacts',
  'settings.callsign': 'Your Roger Callsign',
  'settings.copy': 'Copy',
  'settings.copied': 'Copied',
  'settings.saving': 'Saving...',
  'settings.saved': '✓ Saved',
  'settings.replay_orientation': 'Orientation',
  'settings.replay_orientation_desc': 'Walk through all 13 capability chapters again.',
  'settings.replay': 'Replay',
  'settings.mission_brief': 'Mission Brief',
  'settings.mission_brief_desc': "Review Roger's capabilities from the beginning.",

  // ══════════════════════════════════════════════════════════════
  // ONBOARDING (Onboarding.tsx)
  // ══════════════════════════════════════════════════════════════
  'onboarding.welcome': 'Welcome to Roger AI',
  'onboarding.getting_started': 'Getting Started',
  'onboarding.whats_your_name': "What's your name, Commander?",
  'onboarding.continue': 'Continue',
  'onboarding.review_title': 'Review Your Profile',
  'onboarding.start_roger': 'Activate Roger',

  // ══════════════════════════════════════════════════════════════
  // LANGUAGE GATE (LanguageGate.tsx)
  // ══════════════════════════════════════════════════════════════
  'gate.hold_your_language': 'Hold when you hear YOUR language',
  'gate.or_tap': '— or tap your language —',
  'gate.which_dialect': 'Which dialect?',
  'gate.hold_and_say': 'Hold and say your dialect',
  'gate.confirming': 'Confirming...',
  'gate.locked_in': 'Language locked!',
  'gate.try_again': 'Try again',

  // ══════════════════════════════════════════════════════════════
  // KNOWLEDGE / DEEP DIVE
  // ══════════════════════════════════════════════════════════════
  'knowledge.tell_me_more': 'Tell Me More',
  'knowledge.save_to_encyclopedia': 'Save to Encyclopedia',
  'knowledge.saved': 'Saved to your encyclopedia',
  'knowledge.depth': 'Depth {level}',
  'knowledge.explore': 'Explore',
  'knowledge.related_topics': 'Related Topics',

  // ══════════════════════════════════════════════════════════════
  // PROACTIVE / SURFACE
  // ══════════════════════════════════════════════════════════════
  'proactive.heads_up': 'Heads up',
  'proactive.from_roger': 'From Roger',
  'proactive.respond_via_ptt': 'Respond via PTT',
  'proactive.dismiss': 'Dismiss',
  'proactive.deferred': 'Deferred — will resurface later',

  // ══════════════════════════════════════════════════════════════
  // CLARIFICATION
  // ══════════════════════════════════════════════════════════════
  'clarification.what_do_you_mean': 'What do you mean?',
  'clarification.pick_one': 'Pick one:',
  'clarification.expired': 'Clarification expired — start fresh',

  // ══════════════════════════════════════════════════════════════
  // AMBIENT / MEETING
  // ══════════════════════════════════════════════════════════════
  'ambient.listening': 'Ambient listening active',
  'ambient.stopped': 'Listening stopped',
  'ambient.analysing': 'Analysing...',

  // ══════════════════════════════════════════════════════════════
  // TUNE IN (P2P)
  // ══════════════════════════════════════════════════════════════
  'tunein.requesting': 'Requesting tune-in...',
  'tunein.incoming': 'Incoming tune-in request',
  'tunein.accept': 'Accept',
  'tunein.decline': 'Decline',
  'tunein.connected': 'Connected',
  'tunein.ended': 'Session ended',
  'tunein.flag': 'Flagged',

  // ══════════════════════════════════════════════════════════════
  // SPOTIFY
  // ══════════════════════════════════════════════════════════════
  'spotify.badge': 'SPT',
  'spotify.not_connected': 'Spotify not connected',

  // ══════════════════════════════════════════════════════════════
  // PERMISSION GATE
  // ══════════════════════════════════════════════════════════════
  'permission.title': 'Roger Needs Access',
  'permission.mic': 'Microphone',
  'permission.mic_desc': 'For voice commands via PTT',
  'permission.location': 'Location',
  'permission.location_desc': 'For geo reminders and commute intel',
  'permission.grant': 'GRANT ACCESS',
};

export default en;
