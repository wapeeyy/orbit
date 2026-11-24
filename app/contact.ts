// WhatsApp admin ORBIT
export const ADMIN_WA_DISPLAY = "+60 11-1489 2341";
export const adminWa = (text = "Hi ORBIT admin, I need some help.") =>
  `https://wa.me/601114892341?text=${encodeURIComponent(text)}`;
