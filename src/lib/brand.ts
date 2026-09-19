/**
 * The maker's mark, shown quietly on the sign-in screen and under the
 * navigation.
 *
 * A name rather than a phrase, so it is data and not an i18n string -- it
 * reads the same in both languages, exactly as an item name does. It is kept
 * apart from `settings.businessName` on purpose: that name is the owner's and
 * is what the pharmacy calls itself; this one only says who built the system,
 * and never stands in for the business on a screen or on a receipt.
 */
export const MAKER = "cuanison";
