// WhatsApp admin ORBIT
export const ADMIN_WA_DISPLAY = "011-1489 2341";
export const adminWa = (text = "Hai admin ORBIT, saya perlukan bantuan.") =>
  `https://wa.me/601114892341?text=${encodeURIComponent(text)}`;
