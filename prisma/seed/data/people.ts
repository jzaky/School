// Fictional families and staff for Horizon International School Dubai.
// All names, occupations and phone numbers are invented. Phone numbers use the
// 555 block so they are clearly fictional.

export type Bi = { en: string; ar: string };

export type FamilySeed = {
  lastName: Bi;
  nationality: Bi;
  guardians: Array<{ firstName: Bi; relationship: Bi; gender: "F" | "M"; occupation: string; phone: string }>;
  children: Array<{ firstName: Bi; gender: "F" | "M"; grade: number }>;
};

export type StaffSeed = {
  key: string;
  firstName: Bi;
  lastName: Bi;
  gender: "F" | "M";
  roles: string[];
  jobTitle: Bi;
  department: string | null;
  subjects: string[];
};

const b = (en: string, ar: string): Bi => ({ en, ar });

const FATHER = b("Father", "الأب");
const MOTHER = b("Mother", "الأم");
const GRANDMOTHER = b("Grandmother", "الجدة");
const UNCLE = b("Uncle", "العم");

const NAT = {
  emirati: b("Emirati", "إماراتي"),
  egyptian: b("Egyptian", "مصري"),
  jordanian: b("Jordanian", "أردني"),
  lebanese: b("Lebanese", "لبناني"),
  syrian: b("Syrian", "سوري"),
  palestinian: b("Palestinian", "فلسطيني"),
  saudi: b("Saudi", "سعودي"),
  moroccan: b("Moroccan", "مغربي"),
  sudanese: b("Sudanese", "سوداني"),
  indian: b("Indian", "هندي"),
  pakistani: b("Pakistani", "باكستاني"),
  british: b("British", "بريطاني"),
  irish: b("Irish", "إيرلندي"),
  american: b("American", "أمريكي"),
  canadian: b("Canadian", "كندي"),
  french: b("French", "فرنسي"),
  russian: b("Russian", "روسي"),
  southAfrican: b("South African", "جنوب أفريقي"),
  korean: b("Korean", "كوري"),
  filipino: b("Filipino", "فلبيني"),
  italian: b("Italian", "إيطالي"),
  german: b("German", "ألماني"),
  australian: b("Australian", "أسترالي"),
  turkish: b("Turkish", "تركي"),
  chinese: b("Chinese", "صيني"),
};

export const FAMILIES: FamilySeed[] = [
  // Emirati families
  {
    lastName: b("Al Hashimi", "الهاشمي"),
    nationality: NAT.emirati,
    guardians: [
      { firstName: b("Saeed", "سعيد"), relationship: FATHER, gender: "M", occupation: "Civil Engineer", phone: "+971 50 555 0101" },
      { firstName: b("Mariam", "مريم"), relationship: MOTHER, gender: "F", occupation: "Paediatrician", phone: "+971 50 555 0102" },
    ],
    children: [
      { firstName: b("Hamdan", "حمدان"), gender: "M", grade: 9 },
      { firstName: b("Shamma", "شمّة"), gender: "F", grade: 11 },
    ],
  },
  {
    lastName: b("Al Falasi", "الفلاسي"),
    nationality: NAT.emirati,
    guardians: [
      { firstName: b("Rashid", "راشد"), relationship: FATHER, gender: "M", occupation: "Government Relations Manager", phone: "+971 50 555 0103" },
      { firstName: b("Noura", "نورة"), relationship: MOTHER, gender: "F", occupation: "Interior Designer", phone: "+971 50 555 0104" },
    ],
    children: [
      { firstName: b("Mohammed", "محمد"), gender: "M", grade: 8 },
      { firstName: b("Hessa", "حصة"), gender: "F", grade: 10 },
      { firstName: b("Sultan", "سلطان"), gender: "M", grade: 12 },
    ],
  },
  {
    lastName: b("Al Shamsi", "الشامسي"),
    nationality: NAT.emirati,
    guardians: [
      { firstName: b("Fatima", "فاطمة"), relationship: MOTHER, gender: "F", occupation: "Bank Relationship Manager", phone: "+971 50 555 0105" },
    ],
    children: [{ firstName: b("Latifa", "لطيفة"), gender: "F", grade: 7 }],
  },
  {
    lastName: b("Al Ketbi", "الكتبي"),
    nationality: NAT.emirati,
    guardians: [
      { firstName: b("Khalifa", "خليفة"), relationship: FATHER, gender: "M", occupation: "Airline Captain", phone: "+971 50 555 0106" },
      { firstName: b("Amna", "آمنة"), relationship: MOTHER, gender: "F", occupation: "Pharmacist", phone: "+971 50 555 0107" },
    ],
    children: [
      { firstName: b("Zayed", "زايد"), gender: "M", grade: 10 },
      { firstName: b("Maitha", "ميثاء"), gender: "F", grade: 8 },
    ],
  },
  {
    lastName: b("Al Suwaidi", "السويدي"),
    nationality: NAT.emirati,
    guardians: [
      { firstName: b("Obaid", "عبيد"), relationship: FATHER, gender: "M", occupation: "Business Owner", phone: "+971 50 555 0108" },
    ],
    children: [
      { firstName: b("Rashed", "راشد"), gender: "M", grade: 11 },
      { firstName: b("Alia", "علياء"), gender: "F", grade: 9 },
    ],
  },
  {
    lastName: b("Al Nuaimi", "النعيمي"),
    nationality: NAT.emirati,
    guardians: [
      { firstName: b("Majid", "ماجد"), relationship: FATHER, gender: "M", occupation: "Police Officer", phone: "+971 50 555 0109" },
      { firstName: b("Shaikha", "شيخة"), relationship: MOTHER, gender: "F", occupation: "University Lecturer", phone: "+971 50 555 0110" },
    ],
    children: [{ firstName: b("Mansour", "منصور"), gender: "M", grade: 6 }],
  },
  {
    lastName: b("Al Mazrouei", "المزروعي"),
    nationality: NAT.emirati,
    guardians: [
      { firstName: b("Hamad", "حمد"), relationship: FATHER, gender: "M", occupation: "Energy Analyst", phone: "+971 50 555 0111" },
      { firstName: b("Moza", "موزة"), relationship: MOTHER, gender: "F", occupation: "Human Resources Director", phone: "+971 50 555 0112" },
    ],
    children: [
      { firstName: b("Salama", "سلامة"), gender: "F", grade: 11 },
      { firstName: b("Khalid", "خالد"), gender: "M", grade: 9 },
    ],
  },
  {
    lastName: b("Al Dhaheri", "الظاهري"),
    nationality: NAT.emirati,
    guardians: [
      { firstName: b("Juma", "جمعة"), relationship: FATHER, gender: "M", occupation: "Logistics Manager", phone: "+971 50 555 0113" },
      { firstName: b("Aysha", "عائشة"), relationship: GRANDMOTHER, gender: "F", occupation: "Retired", phone: "+971 50 555 0114" },
    ],
    children: [{ firstName: b("Abdulla", "عبدالله"), gender: "M", grade: 10 }],
  },
  {
    lastName: b("Al Marri", "المري"),
    nationality: NAT.emirati,
    guardians: [
      { firstName: b("Reem", "ريم"), relationship: MOTHER, gender: "F", occupation: "Architect", phone: "+971 50 555 0115" },
      { firstName: b("Faisal", "فيصل"), relationship: FATHER, gender: "M", occupation: "Real Estate Developer", phone: "+971 50 555 0116" },
    ],
    children: [
      { firstName: b("Hind", "هند"), gender: "F", grade: 8 },
      { firstName: b("Saif", "سيف"), gender: "M", grade: 12 },
    ],
  },
  {
    lastName: b("Al Blooshi", "البلوشي"),
    nationality: NAT.emirati,
    guardians: [
      { firstName: b("Yousuf", "يوسف"), relationship: FATHER, gender: "M", occupation: "Customs Officer", phone: "+971 50 555 0117" },
    ],
    children: [{ firstName: b("Hazza", "هزاع"), gender: "M", grade: 9 }],
  },
  {
    lastName: b("Al Ali", "العلي"),
    nationality: NAT.emirati,
    guardians: [
      { firstName: b("Wadeema", "وديمة"), relationship: MOTHER, gender: "F", occupation: "HR Manager", phone: "+971 50 555 0118" },
      { firstName: b("Ali", "علي"), relationship: FATHER, gender: "M", occupation: "Project Manager", phone: "+971 50 555 0119" },
    ],
    children: [
      { firstName: b("Mahra", "مهرة"), gender: "F", grade: 10 },
      { firstName: b("Obaid", "عبيد"), gender: "M", grade: 7 },
    ],
  },
  {
    lastName: b("Al Mheiri", "المهيري"),
    nationality: NAT.emirati,
    guardians: [
      { firstName: b("Ibrahim", "إبراهيم"), relationship: FATHER, gender: "M", occupation: "Lawyer", phone: "+971 50 555 0120" },
      { firstName: b("Shamsa", "شمسة"), relationship: MOTHER, gender: "F", occupation: "Dentist", phone: "+971 50 555 0121" },
    ],
    children: [{ firstName: b("Theyab", "ذياب"), gender: "M", grade: 11 }],
  },
  {
    lastName: b("Al Rumaithi", "الرميثي"),
    nationality: NAT.emirati,
    guardians: [
      { firstName: b("Asma", "أسماء"), relationship: MOTHER, gender: "F", occupation: "Family Physician", phone: "+971 50 555 0122" },
    ],
    children: [
      { firstName: b("Meera", "ميرة"), gender: "F", grade: 9 },
      { firstName: b("Humaid", "حميد"), gender: "M", grade: 6 },
    ],
  },
  {
    lastName: b("Al Zaabi", "الزعابي"),
    nationality: NAT.emirati,
    guardians: [
      { firstName: b("Salem", "سالم"), relationship: FATHER, gender: "M", occupation: "Mechanical Engineer", phone: "+971 50 555 0123" },
      { firstName: b("Hamda", "حمدة"), relationship: MOTHER, gender: "F", occupation: "Marketing Specialist", phone: "+971 50 555 0124" },
    ],
    children: [{ firstName: b("Noof", "نوف"), gender: "F", grade: 12 }],
  },
  {
    lastName: b("Al Hammadi", "الحمادي"),
    nationality: NAT.emirati,
    guardians: [
      { firstName: b("Mubarak", "مبارك"), relationship: FATHER, gender: "M", occupation: "Investment Manager", phone: "+971 50 555 0125" },
    ],
    children: [
      { firstName: b("Maryam", "مريم"), gender: "F", grade: 10 },
      { firstName: b("Rashid", "راشد"), gender: "M", grade: 8 },
    ],
  },
  {
    lastName: b("Al Kaabi", "الكعبي"),
    nationality: NAT.emirati,
    guardians: [
      { firstName: b("Hamdan", "حمدان"), relationship: FATHER, gender: "M", occupation: "Military Officer", phone: "+971 50 555 0126" },
      { firstName: b("Maitha", "ميثاء"), relationship: MOTHER, gender: "F", occupation: "Policy Advisor", phone: "+971 50 555 0127" },
    ],
    children: [
      { firstName: b("Rawda", "روضة"), gender: "F", grade: 9 },
      { firstName: b("Mohammed", "محمد"), gender: "M", grade: 11 },
    ],
  },
  {
    lastName: b("Al Shehhi", "الشحي"),
    nationality: NAT.emirati,
    guardians: [
      { firstName: b("Khawla", "خولة"), relationship: MOTHER, gender: "F", occupation: "Electrical Engineer", phone: "+971 50 555 0128" },
      { firstName: b("Hamid", "حامد"), relationship: UNCLE, gender: "M", occupation: "Operations Manager", phone: "+971 50 555 0129" },
    ],
    children: [
      { firstName: b("Saeed", "سعيد"), gender: "M", grade: 10 },
      { firstName: b("Fatima", "فاطمة"), gender: "F", grade: 8 },
    ],
  },

  // Other Arab families
  {
    lastName: b("El Sayed", "السيد"),
    nationality: NAT.egyptian,
    guardians: [
      { firstName: b("Tarek", "طارق"), relationship: FATHER, gender: "M", occupation: "Structural Engineer", phone: "+971 50 555 0130" },
      { firstName: b("Dina", "دينا"), relationship: MOTHER, gender: "F", occupation: "Pharmacist", phone: "+971 50 555 0131" },
    ],
    children: [
      { firstName: b("Youssef", "يوسف"), gender: "M", grade: 9 },
      { firstName: b("Malak", "ملك"), gender: "F", grade: 11 },
    ],
  },
  {
    lastName: b("Mostafa", "مصطفى"),
    nationality: NAT.egyptian,
    guardians: [
      { firstName: b("Rania", "رانيا"), relationship: MOTHER, gender: "F", occupation: "Chartered Accountant", phone: "+971 50 555 0132" },
    ],
    children: [{ firstName: b("Karim", "كريم"), gender: "M", grade: 10 }],
  },
  {
    lastName: b("Haddad", "حداد"),
    nationality: NAT.jordanian,
    guardians: [
      { firstName: b("Samer", "سامر"), relationship: FATHER, gender: "M", occupation: "IT Consultant", phone: "+971 50 555 0133" },
      { firstName: b("Lina", "لينا"), relationship: MOTHER, gender: "F", occupation: "Graphic Designer", phone: "+971 50 555 0134" },
    ],
    children: [
      { firstName: b("Tala", "تالا"), gender: "F", grade: 8 },
      { firstName: b("Adam", "آدم"), gender: "M", grade: 6 },
    ],
  },
  {
    lastName: b("Khoury", "خوري"),
    nationality: NAT.lebanese,
    guardians: [
      { firstName: b("Georges", "جورج"), relationship: FATHER, gender: "M", occupation: "Private Banker", phone: "+971 50 555 0135" },
      { firstName: b("Nadine", "نادين"), relationship: MOTHER, gender: "F", occupation: "Interior Architect", phone: "+971 50 555 0136" },
    ],
    children: [
      { firstName: b("Maya", "مايا"), gender: "F", grade: 10 },
      { firstName: b("Elie", "إيلي"), gender: "M", grade: 12 },
    ],
  },
  {
    lastName: b("Kabbani", "قباني"),
    nationality: NAT.syrian,
    guardians: [
      { firstName: b("Bassel", "باسل"), relationship: FATHER, gender: "M", occupation: "Orthopaedic Surgeon", phone: "+971 50 555 0137" },
      { firstName: b("Rasha", "رشا"), relationship: MOTHER, gender: "F", occupation: "Dietitian", phone: "+971 50 555 0138" },
    ],
    children: [
      { firstName: b("Jude", "جود"), gender: "F", grade: 9 },
      { firstName: b("Hamza", "حمزة"), gender: "M", grade: 11 },
    ],
  },
  {
    lastName: b("Odeh", "عودة"),
    nationality: NAT.palestinian,
    guardians: [
      { firstName: b("Hala", "هلا"), relationship: MOTHER, gender: "F", occupation: "Journalist", phone: "+971 50 555 0139" },
      { firstName: b("Nader", "نادر"), relationship: FATHER, gender: "M", occupation: "Hotel Operations Manager", phone: "+971 50 555 0140" },
    ],
    children: [{ firstName: b("Lana", "لانا"), gender: "F", grade: 8 }],
  },
  {
    lastName: b("Al Otaibi", "العتيبي"),
    nationality: NAT.saudi,
    guardians: [
      { firstName: b("Fahad", "فهد"), relationship: FATHER, gender: "M", occupation: "Petroleum Engineer", phone: "+971 50 555 0141" },
      { firstName: b("Abeer", "عبير"), relationship: MOTHER, gender: "F", occupation: "Fashion Entrepreneur", phone: "+971 50 555 0142" },
    ],
    children: [
      { firstName: b("Turki", "تركي"), gender: "M", grade: 10 },
      { firstName: b("Jana", "جنى"), gender: "F", grade: 7 },
    ],
  },
  {
    lastName: b("Benali", "بنعلي"),
    nationality: NAT.moroccan,
    guardians: [
      { firstName: b("Youness", "يونس"), relationship: FATHER, gender: "M", occupation: "Hotel General Manager", phone: "+971 50 555 0143" },
      { firstName: b("Salma", "سلمى"), relationship: MOTHER, gender: "F", occupation: "Translator", phone: "+971 50 555 0144" },
    ],
    children: [
      { firstName: b("Rayan", "ريان"), gender: "M", grade: 9 },
      { firstName: b("Ines", "إيناس"), gender: "F", grade: 11 },
    ],
  },
  {
    lastName: b("Osman", "عثمان"),
    nationality: NAT.sudanese,
    guardians: [
      { firstName: b("Mohamed", "محمد"), relationship: FATHER, gender: "M", occupation: "Anaesthetist", phone: "+971 50 555 0145" },
      { firstName: b("Tasneem", "تسنيم"), relationship: MOTHER, gender: "F", occupation: "Laboratory Scientist", phone: "+971 50 555 0146" },
    ],
    children: [
      { firstName: b("Reem", "ريم"), gender: "F", grade: 10 },
      { firstName: b("Ayman", "أيمن"), gender: "M", grade: 12 },
    ],
  },
  {
    lastName: b("Farouk", "فاروق"),
    nationality: NAT.egyptian,
    guardians: [
      { firstName: b("Heba", "هبة"), relationship: MOTHER, gender: "F", occupation: "Marketing Manager", phone: "+971 50 555 0147" },
      { firstName: b("Sherif", "شريف"), relationship: FATHER, gender: "M", occupation: "Sales Director", phone: "+971 50 555 0148" },
    ],
    children: [{ firstName: b("Farida", "فريدة"), gender: "F", grade: 8 }],
  },
  {
    lastName: b("Saleh", "صالح"),
    nationality: NAT.jordanian,
    guardians: [
      { firstName: b("Ziad", "زياد"), relationship: FATHER, gender: "M", occupation: "Telecom Engineer", phone: "+971 50 555 0149" },
    ],
    children: [{ firstName: b("Zaid", "زيد"), gender: "M", grade: 11 }],
  },
  {
    lastName: b("Abboud", "عبود"),
    nationality: NAT.lebanese,
    guardians: [
      { firstName: b("Rita", "ريتا"), relationship: MOTHER, gender: "F", occupation: "Architect", phone: "+971 50 555 0150" },
      { firstName: b("Fadi", "فادي"), relationship: FATHER, gender: "M", occupation: "Restaurant Owner", phone: "+971 50 555 0151" },
    ],
    children: [
      { firstName: b("Karl", "كارل"), gender: "M", grade: 9 },
      { firstName: b("Nour", "نور"), gender: "F", grade: 12 },
    ],
  },
  {
    lastName: b("Darwish", "درويش"),
    nationality: NAT.syrian,
    guardians: [
      { firstName: b("Kinan", "كنان"), relationship: FATHER, gender: "M", occupation: "Pharmacist", phone: "+971 50 555 0152" },
      { firstName: b("Ruba", "ربى"), relationship: MOTHER, gender: "F", occupation: "Early Years Teacher", phone: "+971 50 555 0153" },
    ],
    children: [{ firstName: b("Yamen", "يامن"), gender: "M", grade: 10 }],
  },
  {
    lastName: b("Al Harbi", "الحربي"),
    nationality: NAT.saudi,
    guardians: [
      { firstName: b("Abdulaziz", "عبدالعزيز"), relationship: FATHER, gender: "M", occupation: "Finance Director", phone: "+971 50 555 0154" },
    ],
    children: [{ firstName: b("Ghala", "غلا"), gender: "F", grade: 9 }],
  },
  {
    lastName: b("Tamimi", "التميمي"),
    nationality: NAT.palestinian,
    guardians: [
      { firstName: b("Rami", "رامي"), relationship: FATHER, gender: "M", occupation: "Software Engineer", phone: "+971 50 555 0155" },
      { firstName: b("Suha", "سهى"), relationship: MOTHER, gender: "F", occupation: "Speech Therapist", phone: "+971 50 555 0156" },
    ],
    children: [
      { firstName: b("Tamer", "تامر"), gender: "M", grade: 11 },
      { firstName: b("Dana", "دانة"), gender: "F", grade: 9 },
    ],
  },

  // South Asian families
  {
    lastName: b("Sharma", "شارما"),
    nationality: NAT.indian,
    guardians: [
      { firstName: b("Rohit", "روهيت"), relationship: FATHER, gender: "M", occupation: "Finance Director", phone: "+971 50 555 0157" },
      { firstName: b("Priya", "بريا"), relationship: MOTHER, gender: "F", occupation: "Data Analyst", phone: "+971 50 555 0158" },
    ],
    children: [
      { firstName: b("Aarav", "آراف"), gender: "M", grade: 9 },
      { firstName: b("Ananya", "أنانيا"), gender: "F", grade: 11 },
    ],
  },
  {
    lastName: b("Menon", "مينون"),
    nationality: NAT.indian,
    guardians: [
      { firstName: b("Lakshmi", "لاكشمي"), relationship: MOTHER, gender: "F", occupation: "Cardiologist", phone: "+971 50 555 0159" },
      { firstName: b("Arjun", "أرجون"), relationship: FATHER, gender: "M", occupation: "Supply Chain Manager", phone: "+971 50 555 0160" },
    ],
    children: [{ firstName: b("Diya", "ديا"), gender: "F", grade: 8 }],
  },
  {
    lastName: b("Iyer", "آير"),
    nationality: NAT.indian,
    guardians: [
      { firstName: b("Venkat", "فينكات"), relationship: FATHER, gender: "M", occupation: "Process Engineer", phone: "+971 50 555 0161" },
      { firstName: b("Meenakshi", "ميناكشي"), relationship: MOTHER, gender: "F", occupation: "Chartered Accountant", phone: "+971 50 555 0162" },
    ],
    children: [
      { firstName: b("Nikhil", "نيخيل"), gender: "M", grade: 10 },
      { firstName: b("Kavya", "كافيا"), gender: "F", grade: 12 },
    ],
  },
  {
    lastName: b("Qureshi", "قريشي"),
    nationality: NAT.pakistani,
    guardians: [
      { firstName: b("Imran", "عمران"), relationship: FATHER, gender: "M", occupation: "Banker", phone: "+971 50 555 0163" },
      { firstName: b("Sana", "سناء"), relationship: MOTHER, gender: "F", occupation: "Dentist", phone: "+971 50 555 0164" },
    ],
    children: [
      { firstName: b("Zain", "زين"), gender: "M", grade: 9 },
      { firstName: b("Aleena", "ألينا"), gender: "F", grade: 7 },
    ],
  },
  {
    lastName: b("Siddiqui", "صديقي"),
    nationality: NAT.pakistani,
    guardians: [
      { firstName: b("Mahnoor", "ماهنور"), relationship: MOTHER, gender: "F", occupation: "Clinical Pharmacist", phone: "+971 50 555 0165" },
    ],
    children: [{ firstName: b("Ibrahim", "إبراهيم"), gender: "M", grade: 10 }],
  },
  {
    lastName: b("Patel", "باتيل"),
    nationality: NAT.indian,
    guardians: [
      { firstName: b("Ketan", "كيتان"), relationship: FATHER, gender: "M", occupation: "Business Owner", phone: "+971 50 555 0166" },
      { firstName: b("Hetal", "هيتال"), relationship: MOTHER, gender: "F", occupation: "Boutique Owner", phone: "+971 50 555 0167" },
    ],
    children: [
      { firstName: b("Riya", "ريا"), gender: "F", grade: 10 },
      { firstName: b("Dev", "ديف"), gender: "M", grade: 6 },
    ],
  },
  {
    lastName: b("Malik", "مالك"),
    nationality: NAT.pakistani,
    guardians: [
      { firstName: b("Usman", "عثمان"), relationship: FATHER, gender: "M", occupation: "Airline First Officer", phone: "+971 50 555 0168" },
      { firstName: b("Hira", "حراء"), relationship: MOTHER, gender: "F", occupation: "Psychologist", phone: "+971 50 555 0169" },
    ],
    children: [{ firstName: b("Areeba", "أريبة"), gender: "F", grade: 11 }],
  },
  {
    lastName: b("Nair", "ناير"),
    nationality: NAT.indian,
    guardians: [
      { firstName: b("Suresh", "سوريش"), relationship: FATHER, gender: "M", occupation: "General Surgeon", phone: "+971 50 555 0170" },
      { firstName: b("Deepa", "ديبا"), relationship: MOTHER, gender: "F", occupation: "Quality Assurance Manager", phone: "+971 50 555 0171" },
    ],
    children: [{ firstName: b("Aditya", "أديتيا"), gender: "M", grade: 11 }],
  },

  // British, Irish, American, Canadian families
  {
    lastName: b("Thompson", "طومسون"),
    nationality: NAT.british,
    guardians: [
      { firstName: b("James", "جيمس"), relationship: FATHER, gender: "M", occupation: "Investment Banker", phone: "+971 50 555 0172" },
      { firstName: b("Charlotte", "شارلوت"), relationship: MOTHER, gender: "F", occupation: "Recruitment Consultant", phone: "+971 50 555 0173" },
    ],
    children: [
      { firstName: b("Oliver", "أوليفر"), gender: "M", grade: 9 },
      { firstName: b("Amelia", "أميليا"), gender: "F", grade: 11 },
    ],
  },
  {
    lastName: b("Walsh", "والش"),
    nationality: NAT.irish,
    guardians: [
      { firstName: b("Siobhan", "شيفون"), relationship: MOTHER, gender: "F", occupation: "Nurse Manager", phone: "+971 50 555 0174" },
    ],
    children: [{ firstName: b("Liam", "ليام"), gender: "M", grade: 10 }],
  },
  {
    lastName: b("Hughes", "هيوز"),
    nationality: NAT.british,
    guardians: [
      { firstName: b("Matthew", "ماثيو"), relationship: FATHER, gender: "M", occupation: "Management Consultant", phone: "+971 50 555 0175" },
      { firstName: b("Emma", "إيما"), relationship: MOTHER, gender: "F", occupation: "Physiotherapist", phone: "+971 50 555 0176" },
    ],
    children: [
      { firstName: b("George", "جورج"), gender: "M", grade: 8 },
      { firstName: b("Isla", "آيلا"), gender: "F", grade: 12 },
    ],
  },
  {
    lastName: b("Bennett", "بينيت"),
    nationality: NAT.british,
    guardians: [
      { firstName: b("Rachel", "راشيل"), relationship: MOTHER, gender: "F", occupation: "Corporate Lawyer", phone: "+971 50 555 0177" },
      { firstName: b("Tom", "توم"), relationship: FATHER, gender: "M", occupation: "Property Consultant", phone: "+971 50 555 0178" },
    ],
    children: [{ firstName: b("Freya", "فريا"), gender: "F", grade: 9 }],
  },
  {
    lastName: b("Miller", "ميلر"),
    nationality: NAT.american,
    guardians: [
      { firstName: b("Ryan", "رايان"), relationship: FATHER, gender: "M", occupation: "Aviation Engineer", phone: "+971 50 555 0179" },
      { firstName: b("Jessica", "جيسيكا"), relationship: MOTHER, gender: "F", occupation: "Communications Manager", phone: "+971 50 555 0180" },
    ],
    children: [
      { firstName: b("Ethan", "إيثان"), gender: "M", grade: 11 },
      { firstName: b("Chloe", "كلوي"), gender: "F", grade: 8 },
    ],
  },
  {
    lastName: b("Johnson", "جونسون"),
    nationality: NAT.american,
    guardians: [
      { firstName: b("Marcus", "ماركوس"), relationship: FATHER, gender: "M", occupation: "Diplomat", phone: "+971 50 555 0181" },
      { firstName: b("Tanya", "تانيا"), relationship: MOTHER, gender: "F", occupation: "Nonprofit Director", phone: "+971 50 555 0182" },
    ],
    children: [{ firstName: b("Jordan", "جوردان"), gender: "M", grade: 12 }],
  },
  {
    lastName: b("Tremblay", "ترمبلاي"),
    nationality: NAT.canadian,
    guardians: [
      { firstName: b("Luc", "لوك"), relationship: FATHER, gender: "M", occupation: "Infrastructure Engineer", phone: "+971 50 555 0183" },
      { firstName: b("Isabelle", "إيزابيل"), relationship: MOTHER, gender: "F", occupation: "Veterinarian", phone: "+971 50 555 0184" },
    ],
    children: [{ firstName: b("Léa", "ليا"), gender: "F", grade: 10 }],
  },
  {
    lastName: b("Campbell", "كامبل"),
    nationality: NAT.canadian,
    guardians: [
      { firstName: b("Heather", "هيذر"), relationship: MOTHER, gender: "F", occupation: "University Administrator", phone: "+971 50 555 0185" },
    ],
    children: [
      { firstName: b("Noah", "نوح"), gender: "M", grade: 9 },
      { firstName: b("Ava", "إيفا"), gender: "F", grade: 6 },
    ],
  },

  // European families
  {
    lastName: b("Dubois", "دوبوا"),
    nationality: NAT.french,
    guardians: [
      { firstName: b("Antoine", "أنطوان"), relationship: FATHER, gender: "M", occupation: "Hotel General Manager", phone: "+971 50 555 0186" },
      { firstName: b("Camille", "كاميل"), relationship: MOTHER, gender: "F", occupation: "Pastry Chef", phone: "+971 50 555 0187" },
    ],
    children: [
      { firstName: b("Louis", "لويس"), gender: "M", grade: 10 },
      { firstName: b("Manon", "مانون"), gender: "F", grade: 8 },
    ],
  },
  {
    lastName: b("Petrov", "بيتروف"),
    nationality: NAT.russian,
    guardians: [
      { firstName: b("Elena", "إيلينا"), relationship: MOTHER, gender: "F", occupation: "Economist", phone: "+971 50 555 0188" },
      { firstName: b("Dmitri", "دميتري"), relationship: FATHER, gender: "M", occupation: "Trading Company Director", phone: "+971 50 555 0189" },
    ],
    children: [{ firstName: b("Sofia", "صوفيا"), gender: "F", grade: 9 }],
  },
  {
    lastName: b("Volkov", "فولكوف"),
    nationality: NAT.russian,
    guardians: [
      { firstName: b("Sergei", "سيرغي"), relationship: FATHER, gender: "M", occupation: "Petroleum Geologist", phone: "+971 50 555 0190" },
      { firstName: b("Olga", "أولغا"), relationship: MOTHER, gender: "F", occupation: "Pianist", phone: "+971 50 555 0191" },
    ],
    children: [{ firstName: b("Artem", "أرتيوم"), gender: "M", grade: 11 }],
  },
  {
    lastName: b("Rossi", "روسي"),
    nationality: NAT.italian,
    guardians: [
      { firstName: b("Marco", "ماركو"), relationship: FATHER, gender: "M", occupation: "Architect", phone: "+971 50 555 0192" },
      { firstName: b("Giulia", "جوليا"), relationship: MOTHER, gender: "F", occupation: "Art Gallery Curator", phone: "+971 50 555 0193" },
    ],
    children: [{ firstName: b("Luca", "لوكا"), gender: "M", grade: 10 }],
  },
  {
    lastName: b("Schneider", "شنايدر"),
    nationality: NAT.german,
    guardians: [
      { firstName: b("Tobias", "توبياس"), relationship: FATHER, gender: "M", occupation: "Automotive Engineer", phone: "+971 50 555 0194" },
    ],
    children: [
      { firstName: b("Lena", "لينا"), gender: "F", grade: 9 },
      { firstName: b("Felix", "فيليكس"), gender: "M", grade: 12 },
    ],
  },

  // South African, Australian families
  {
    lastName: b("van der Merwe", "فان دير ميروي"),
    nationality: NAT.southAfrican,
    guardians: [
      { firstName: b("Pieter", "بيتر"), relationship: FATHER, gender: "M", occupation: "Mining Consultant", phone: "+971 50 555 0195" },
      { firstName: b("Annelie", "أنيلي"), relationship: MOTHER, gender: "F", occupation: "Occupational Therapist", phone: "+971 50 555 0196" },
    ],
    children: [
      { firstName: b("Ruan", "روان"), gender: "M", grade: 10 },
      { firstName: b("Mia", "ميا"), gender: "F", grade: 8 },
    ],
  },
  {
    lastName: b("Naidoo", "نايدو"),
    nationality: NAT.southAfrican,
    guardians: [
      { firstName: b("Kerisha", "كيريشا"), relationship: MOTHER, gender: "F", occupation: "Radiologist", phone: "+971 50 555 0197" },
      { firstName: b("Kevin", "كيفن"), relationship: FATHER, gender: "M", occupation: "Chartered Accountant", phone: "+971 50 555 0198" },
    ],
    children: [{ firstName: b("Kiara", "كيارا"), gender: "F", grade: 11 }],
  },
  {
    lastName: b("Wilson", "ويلسون"),
    nationality: NAT.australian,
    guardians: [
      { firstName: b("Kate", "كيت"), relationship: MOTHER, gender: "F", occupation: "Physiotherapist", phone: "+971 50 555 0199" },
      { firstName: b("Ben", "بن"), relationship: FATHER, gender: "M", occupation: "Construction Project Director", phone: "+971 50 555 0200" },
    ],
    children: [
      { firstName: b("Ruby", "روبي"), gender: "F", grade: 10 },
      { firstName: b("Jack", "جاك"), gender: "M", grade: 8 },
    ],
  },

  // East and Southeast Asian families
  {
    lastName: b("Kim", "كيم"),
    nationality: NAT.korean,
    guardians: [
      { firstName: b("Min-jun", "مين جون"), relationship: FATHER, gender: "M", occupation: "Construction Engineer", phone: "+971 50 555 0201" },
      { firstName: b("Ji-yeon", "جي يون"), relationship: MOTHER, gender: "F", occupation: "Korean Language Tutor", phone: "+971 50 555 0202" },
    ],
    children: [
      { firstName: b("Seo-yeon", "سو يون"), gender: "F", grade: 9 },
      { firstName: b("Joon-ho", "جون هو"), gender: "M", grade: 7 },
    ],
  },
  {
    lastName: b("Park", "بارك"),
    nationality: NAT.korean,
    guardians: [
      { firstName: b("Soo-jin", "سو جين"), relationship: MOTHER, gender: "F", occupation: "Nuclear Energy Engineer", phone: "+971 50 555 0203" },
    ],
    children: [{ firstName: b("Ji-ho", "جي هو"), gender: "M", grade: 10 }],
  },
  {
    lastName: b("Santos", "سانتوس"),
    nationality: NAT.filipino,
    guardians: [
      { firstName: b("Miguel", "ميغيل"), relationship: FATHER, gender: "M", occupation: "Hospital Administrator", phone: "+971 50 555 0204" },
      { firstName: b("Maricel", "ماريسيل"), relationship: MOTHER, gender: "F", occupation: "Registered Nurse", phone: "+971 50 555 0205" },
    ],
    children: [
      { firstName: b("Gabriel", "غابرييل"), gender: "M", grade: 8 },
      { firstName: b("Andrea", "أندريا"), gender: "F", grade: 11 },
    ],
  },
  {
    lastName: b("Reyes", "رييس"),
    nationality: NAT.filipino,
    guardians: [
      { firstName: b("Joanna", "جوانا"), relationship: MOTHER, gender: "F", occupation: "Accountant", phone: "+971 50 555 0206" },
    ],
    children: [{ firstName: b("Angelo", "أنجيلو"), gender: "M", grade: 9 }],
  },
  {
    lastName: b("Chen", "تشين"),
    nationality: NAT.chinese,
    guardians: [
      { firstName: b("Wei", "وي"), relationship: FATHER, gender: "M", occupation: "Trade Manager", phone: "+971 50 555 0207" },
      { firstName: b("Lina", "لينا"), relationship: MOTHER, gender: "F", occupation: "Financial Analyst", phone: "+971 50 555 0208" },
    ],
    children: [{ firstName: b("Mei", "مي"), gender: "F", grade: 8 }],
  },
  {
    lastName: b("Yilmaz", "يلماز"),
    nationality: NAT.turkish,
    guardians: [
      { firstName: b("Emre", "أمره"), relationship: FATHER, gender: "M", occupation: "Software Architect", phone: "+971 50 555 0209" },
      { firstName: b("Zeynep", "زينب"), relationship: MOTHER, gender: "F", occupation: "Dentist", phone: "+971 50 555 0210" },
    ],
    children: [{ firstName: b("Elif", "إليف"), gender: "F", grade: 9 }],
  },
];

const t = (
  key: string,
  firstName: Bi,
  lastName: Bi,
  gender: "F" | "M",
  jobTitle: Bi,
  department: string | null,
  subjects: string[],
  roles: string[] = ["teacher"],
): StaffSeed => ({ key, firstName, lastName, gender, roles, jobTitle, department, subjects });

const HOD = ["teacher", "department_head"];

export const STAFF: StaffSeed[] = [
  // Leadership and student services
  t("deputy_dsl_main", b("Richard", "ريتشارد"), b("Evans", "إيفانز"), "M",
    b("Head of Secondary and Assistant Principal", "رئيس المرحلة الثانوية ومساعد المدير"), "administration", ["PSY"], ["deputy_dsl", "teacher"]),
  t("registrar_main", b("Mona", "منى"), b("Al Awadhi", "العوضي"), "F",
    b("Registrar", "مسؤولة التسجيل"), "administration", [], ["registrar"]),
  t("wellbeing_lead_main", b("Hannah", "هانا"), b("Morrison", "موريسون"), "F",
    b("Wellbeing Lead", "مسؤولة الرفاه"), "student_services", [], ["wellbeing_lead"]),
  t("counselor_second", b("Dalia", "داليا"), b("Fawzi", "فوزي"), "F",
    b("School Counsellor", "مرشدة طلابية"), "student_services", [], ["counselor"]),
  t("nurse_main", b("Grace", "غريس"), b("Mendoza", "مندوزا"), "F",
    b("School Nurse", "ممرضة المدرسة"), "student_services", [], ["nurse"]),
  t("it_support_main", b("Vikram", "فيكرام"), b("Rao", "راو"), "M",
    b("IT Support Specialist", "أخصائي الدعم التقني"), "administration", [], ["it_support"]),

  // Heads of department
  t("hod_science", b("Nadia", "نادية"), b("Karam", "كرم"), "F",
    b("Head of Science", "رئيسة قسم العلوم"), "science", ["CHEM", "BIO"], HOD),
  t("hod_mathematics", b("Paul", "بول"), b("Whitfield", "ويتفيلد"), "M",
    b("Head of Mathematics", "رئيس قسم الرياضيات"), "mathematics", ["MATH"], HOD),
  t("hod_computing", b("Anand", "أناند"), b("Krishnan", "كريشنان"), "M",
    b("Head of Computing", "رئيس قسم الحوسبة"), "computing", ["CS"], HOD),
  t("hod_english", b("Fiona", "فيونا"), b("Grant", "غرانت"), "F",
    b("Head of English", "رئيسة قسم اللغة الإنجليزية"), "english", ["ENG"], HOD),
  t("hod_arabic_islamic", b("Abdullah", "عبدالله"), b("Al Naqbi", "النقبي"), "M",
    b("Head of Arabic and Islamic Studies", "رئيس قسم اللغة العربية والتربية الإسلامية"), "arabic_islamic", ["ARAB", "ISL"], HOD),
  t("hod_humanities", b("Claire", "كلير"), b("Dupont", "دوبون"), "F",
    b("Head of Humanities", "رئيسة قسم العلوم الإنسانية"), "humanities", ["HIST", "GEO"], HOD),
  t("hod_arts", b("Sofia", "صوفيا"), b("Marquez", "ماركيز"), "F",
    b("Head of Creative Arts", "رئيسة قسم الفنون الإبداعية"), "arts", ["ART", "DT"], HOD),
  t("hod_pe", b("Craig", "كريغ"), b("Botha", "بوتا"), "M",
    b("Head of Physical Education", "رئيس قسم التربية البدنية"), "pe", ["PE"], HOD),

  // Science
  t("physics_teacher", b("Thomas", "توماس"), b("Reid", "ريد"), "M",
    b("Physics Teacher", "معلم الفيزياء"), "science", ["PHYS"]),
  t("chemistry_teacher", b("Rasha", "رشا"), b("Abdelaziz", "عبدالعزيز"), "F",
    b("Chemistry Teacher", "معلمة الكيمياء"), "science", ["CHEM"]),
  t("biology_teacher", b("Meera", "ميرا"), b("Pillai", "بيلاي"), "F",
    b("Biology Teacher", "معلمة الأحياء"), "science", ["BIO"]),
  t("science_teacher", b("Jonathan", "جوناثان"), b("Price", "برايس"), "M",
    b("Science Teacher", "معلم العلوم"), "science", ["BIO", "CHEM", "PHYS"]),

  // Mathematics
  t("math_teacher", b("Waleed", "وليد"), b("Barakat", "بركات"), "M",
    b("Mathematics Teacher", "معلم الرياضيات"), "mathematics", ["MATH"]),
  t("math_teacher_2", b("Priyanka", "بريانكا"), b("Desai", "ديساي"), "F",
    b("Mathematics Teacher", "معلمة الرياضيات"), "mathematics", ["MATH"]),
  t("math_teacher_3", b("Kevin", "كيفن"), b("O'Brien", "أوبراين"), "M",
    b("Mathematics Teacher", "معلم الرياضيات"), "mathematics", ["MATH"]),

  // Computing
  t("cs_teacher", b("Sana", "سناء"), b("Mirza", "ميرزا"), "F",
    b("Computer Science Teacher", "معلمة علوم الحاسوب"), "computing", ["CS"]),
  t("ict_teacher", b("Lucas", "لوكاس"), b("Ferreira", "فيريرا"), "M",
    b("Computing and ICT Teacher", "معلم الحوسبة وتقنية المعلومات"), "computing", ["CS"]),

  // English
  t("english_teacher", b("Rebecca", "ريبيكا"), b("Lawson", "لوسون"), "F",
    b("English Teacher", "معلمة اللغة الإنجليزية"), "english", ["ENG"]),
  t("english_teacher_2", b("Michael", "مايكل"), b("Adeyemi", "أديمي"), "M",
    b("English Teacher", "معلم اللغة الإنجليزية"), "english", ["ENG"]),

  // Arabic and Islamic Studies
  t("arabic_teacher", b("Huda", "هدى"), b("Al Marzouqi", "المرزوقي"), "F",
    b("Arabic Teacher", "معلمة اللغة العربية"), "arabic_islamic", ["ARAB"]),
  t("arabic_teacher_2", b("Yasser", "ياسر"), b("Shalaby", "شلبي"), "M",
    b("Arabic Teacher", "معلم اللغة العربية"), "arabic_islamic", ["ARAB"]),
  t("islamic_teacher", b("Mohammed", "محمد"), b("Al Zarooni", "الزروني"), "M",
    b("Islamic Education Teacher", "معلم التربية الإسلامية"), "arabic_islamic", ["ISL", "SOC"]),

  // Humanities
  t("history_teacher", b("Andrew", "أندرو"), b("Collins", "كولينز"), "M",
    b("History Teacher", "معلم التاريخ"), "humanities", ["HIST"]),
  t("geography_teacher", b("Aoife", "إيفا"), b("Brennan", "برينان"), "F",
    b("Geography Teacher", "معلمة الجغرافيا"), "humanities", ["GEO"]),
  t("economics_teacher", b("Rohan", "روهان"), b("Kapoor", "كابور"), "M",
    b("Economics and Business Teacher", "معلم الاقتصاد وإدارة الأعمال"), "humanities", ["ECON", "BUS"]),
  t("psychology_teacher", b("Emily", "إيميلي"), b("Hart", "هارت"), "F",
    b("Psychology Teacher", "معلمة علم النفس"), "humanities", ["PSY", "SOC"]),
  t("french_teacher", b("Julien", "جوليان"), b("Moreau", "مورو"), "M",
    b("French Teacher", "معلم اللغة الفرنسية"), "humanities", ["FR"]),

  // Creative Arts
  t("art_teacher", b("Noor", "نور"), b("Kanaan", "كنعان"), "F",
    b("Art Teacher", "معلمة الفنون"), "arts", ["ART"]),
  t("dt_teacher", b("Sipho", "سيفو"), b("Dlamini", "دلاميني"), "M",
    b("Design and Technology Teacher", "معلم التصميم والتكنولوجيا"), "arts", ["DT"]),
  t("music_teacher", b("Anna", "آنا"), b("Kowalska", "كوالسكا"), "F",
    b("Music Teacher", "معلمة الموسيقى"), "arts", ["MUSIC"]),

  // Physical Education
  t("pe_teacher", b("Maria", "ماريا"), b("Villanueva", "فيلانويفا"), "F",
    b("Physical Education Teacher", "معلمة التربية البدنية"), "pe", ["PE"]),
  t("pe_teacher_2", b("Hamad", "حمد"), b("Al Jaberi", "الجابري"), "M",
    b("Physical Education Teacher", "معلم التربية البدنية"), "pe", ["PE"]),

  // Learning support
  t("learning_support_teacher", b("Olivia", "أوليفيا"), b("Hayes", "هايز"), "F",
    b("Learning Support Teacher", "معلمة الدعم التعليمي"), "student_services", ["ENG", "MATH"]),
];
