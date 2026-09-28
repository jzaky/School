// Careers catalog used by the career guidance module.
// Weights follow DIMENSIONS order: analytical, verbal, spatial, investigative, creative,
// social, enterprising, technical, organized (each 0 to 5).
// Salaries are indicative MONTHLY ranges in AED for the UAE market.
import type { CareerSeed, CareerWeights } from "@/server/career/dimensions";

function w(
  analytical: number,
  verbal: number,
  spatial: number,
  investigative: number,
  creative: number,
  social: number,
  enterprising: number,
  technical: number,
  organized: number,
): CareerWeights {
  return { analytical, verbal, spatial, investigative, creative, social, enterprising, technical, organized };
}

const TECH = { en: "Technology", ar: "التكنولوجيا" };
const ENG = { en: "Engineering", ar: "الهندسة" };
const HEALTH = { en: "Health", ar: "الصحة والطب" };
const SCI = { en: "Science", ar: "العلوم" };
const BIZ = { en: "Business and Finance", ar: "الأعمال والمالية" };
const MEDIA = { en: "Creative and Media", ar: "الإبداع والإعلام" };
const EDU = { en: "Education and Social", ar: "التعليم والخدمة الاجتماعية" };
const LAW = { en: "Law and Government", ar: "القانون والعمل الحكومي" };
const AVI = { en: "Aviation and Hospitality", ar: "الطيران والضيافة" };
const SUS = { en: "Sustainability and Energy", ar: "الاستدامة والطاقة" };
const SPORT = { en: "Sports", ar: "الرياضة" };

export const CAREERS: CareerSeed[] = [
  // ---------------- Technology ----------------
  {
    key: "ai_engineer",
    title: { en: "AI Engineer", ar: "مهندس ذكاء اصطناعي" },
    cluster: TECH,
    summary: {
      en: "Designs, trains and deploys machine learning models that power products such as chat assistants, smart city systems and medical imaging tools.",
      ar: "يصمّم نماذج التعلّم الآلي ويدرّبها ويطلقها لتشغّل منتجات مثل المساعدات الذكية وأنظمة المدن الذكية وأدوات التصوير الطبي.",
    },
    dayInLife: {
      en: "You might start by reviewing overnight training results, then clean a new dataset, test a model's accuracy and meet the product team to plan the next release.",
      ar: "قد يبدأ يومك بمراجعة نتائج التدريب الليلي، ثم تنظيف مجموعة بيانات جديدة واختبار دقة النموذج، قبل الاجتماع بفريق المنتج للتخطيط للإصدار التالي.",
    },
    weights: w(5, 2, 2, 5, 3, 1, 2, 4, 3),
    subjects: ["MATH", "CS", "PHYS"],
    skills: {
      en: ["Python programming", "Machine learning", "Statistics", "Problem solving"],
      ar: ["البرمجة بلغة بايثون", "التعلّم الآلي", "الإحصاء", "حل المشكلات"],
    },
    education: {
      en: "A degree in computer science, AI or mathematics, often followed by a master's at MBZUAI, Khalifa University or a leading university abroad.",
      ar: "بكالوريوس في علوم الحاسوب أو الذكاء الاصطناعي أو الرياضيات، يتبعه غالبًا ماجستير في جامعة محمد بن زايد للذكاء الاصطناعي أو جامعة خليفة أو جامعة مرموقة في الخارج.",
    },
    salaryMinAed: 25000,
    salaryMaxAed: 60000,
    outlook: "emerging",
    uaeDemand: 5,
  },
  {
    key: "software_developer",
    title: { en: "Software Developer", ar: "مطوّر برمجيات" },
    cluster: TECH,
    summary: {
      en: "Writes, tests and maintains the code behind apps, websites and business systems used by millions of people.",
      ar: "يكتب الشيفرات البرمجية ويختبرها ويطوّرها باستمرار لتشغيل التطبيقات والمواقع والأنظمة التي يستخدمها الملايين.",
    },
    dayInLife: {
      en: "A typical day includes a short team stand-up, building a new feature, reviewing a colleague's code and fixing bugs reported by users.",
      ar: "يتضمن اليوم المعتاد اجتماعًا قصيرًا مع الفريق، وبناء ميزة جديدة، ومراجعة شيفرة أحد الزملاء، وإصلاح الأخطاء التي أبلغ عنها المستخدمون.",
    },
    weights: w(5, 2, 2, 3, 3, 2, 2, 4, 4),
    subjects: ["CS", "MATH"],
    skills: {
      en: ["Programming", "Logical thinking", "Teamwork", "Debugging"],
      ar: ["البرمجة", "التفكير المنطقي", "العمل الجماعي", "تتبّع الأخطاء وإصلاحها"],
    },
    education: {
      en: "A bachelor's in computer science or software engineering, available at UAE University, AUS, RIT Dubai and many other universities.",
      ar: "بكالوريوس في علوم الحاسوب أو هندسة البرمجيات، ويُتاح في جامعة الإمارات والجامعة الأمريكية في الشارقة ومعهد روتشستر في دبي وغيرها.",
    },
    salaryMinAed: 15000,
    salaryMaxAed: 40000,
    outlook: "growing",
    uaeDemand: 5,
  },
  {
    key: "data_scientist",
    title: { en: "Data Scientist", ar: "عالم بيانات" },
    cluster: TECH,
    summary: {
      en: "Turns large amounts of data into insights and predictions that help organisations make better decisions.",
      ar: "يحوّل كمًّا كبيرًا من البيانات إلى رؤى وتوقعات تساعد المؤسسات على اتخاذ قرارات أفضل.",
    },
    dayInLife: {
      en: "You could spend the morning exploring data on patient visits or traffic flow, then build a model and present your findings to managers in clear charts.",
      ar: "قد تقضي الصباح في تحليل بيانات زيارات المرضى أو حركة المرور، ثم تبني نموذجًا تنبّئيًا وتعرض نتائجك على الإدارة برسوم بيانية واضحة.",
    },
    weights: w(5, 3, 2, 5, 2, 2, 2, 3, 4),
    subjects: ["MATH", "CS", "ECON"],
    skills: {
      en: ["Statistics", "Data visualisation", "Python and SQL", "Communicating findings"],
      ar: ["الإحصاء", "تصوير البيانات", "لغتا بايثون وSQL", "عرض النتائج بوضوح"],
    },
    education: {
      en: "A degree in data science, statistics, mathematics or computer science, with growing options at Khalifa University and UAE University.",
      ar: "شهادة في علم البيانات أو الإحصاء أو الرياضيات أو علوم الحاسوب، مع خيارات متزايدة في جامعة خليفة وجامعة الإمارات.",
    },
    salaryMinAed: 20000,
    salaryMaxAed: 50000,
    outlook: "growing",
    uaeDemand: 5,
  },
  {
    key: "cybersecurity_analyst",
    title: { en: "Cybersecurity Analyst", ar: "محلل أمن سيبراني" },
    cluster: TECH,
    summary: {
      en: "Protects computer systems and networks from attacks by monitoring threats, finding weaknesses and responding to incidents.",
      ar: "يحمي الأنظمة والشبكات من الهجمات الإلكترونية عبر رصد التهديدات واكتشاف الثغرات والتعامل مع الحوادث الأمنية.",
    },
    dayInLife: {
      en: "You might investigate a suspicious login alert, run a test to find security gaps and train staff to recognise phishing emails.",
      ar: "قد تحقق في تنبيه دخول مشبوه، وتجري اختبارًا لاكتشاف الثغرات، وتدرّب الموظفين على تمييز رسائل التصيّد الاحتيالي.",
    },
    weights: w(5, 2, 1, 4, 2, 2, 1, 5, 4),
    subjects: ["CS", "MATH"],
    skills: {
      en: ["Networking", "Attention to detail", "Ethical hacking", "Calm under pressure"],
      ar: ["الشبكات", "الانتباه للتفاصيل", "الاختراق الأخلاقي", "الهدوء تحت الضغط"],
    },
    education: {
      en: "A degree in cybersecurity or computer science, offered locally at Khalifa University, Middlesex Dubai and the University of Wollongong in Dubai.",
      ar: "شهادة في الأمن السيبراني أو علوم الحاسوب، وتُطرح محليًا في جامعة خليفة وجامعة ميدلسكس دبي وجامعة ولونغونغ في دبي.",
    },
    salaryMinAed: 18000,
    salaryMaxAed: 45000,
    outlook: "growing",
    uaeDemand: 5,
  },

  // ---------------- Engineering ----------------
  {
    key: "robotics_engineer",
    title: { en: "Robotics Engineer", ar: "مهندس روبوتات" },
    cluster: ENG,
    summary: {
      en: "Designs and builds robots and automated systems used in factories, hospitals, logistics hubs and space missions.",
      ar: "يصمّم الروبوتات والأنظمة المؤتمتة ويبنيها لتُستخدم في المصانع والمستشفيات ومراكز الخدمات اللوجستية ومهمات الفضاء.",
    },
    dayInLife: {
      en: "Your day could involve programming a robotic arm, testing sensors in the lab and adjusting a design after a prototype trial.",
      ar: "قد يشمل يومك برمجة ذراع آلية، واختبار أجهزة الاستشعار في المختبر، وتعديل التصميم بعد تجربة النموذج الأولي.",
    },
    weights: w(5, 1, 4, 4, 3, 1, 2, 5, 3),
    subjects: ["MATH", "PHYS", "CS", "DT"],
    skills: {
      en: ["Programming", "Electronics", "Mechanical design", "Systems thinking"],
      ar: ["البرمجة", "الإلكترونيات", "التصميم الميكانيكي", "التفكير المنظومي"],
    },
    education: {
      en: "A degree in mechatronics, mechanical, electrical or computer engineering; Khalifa University and MBZUAI both run strong robotics research.",
      ar: "شهادة في هندسة الميكاترونكس أو الهندسة الميكانيكية أو الكهربائية أو هندسة الحاسوب، ولدى جامعة خليفة وجامعة محمد بن زايد للذكاء الاصطناعي أبحاث متقدمة في الروبوتات.",
    },
    salaryMinAed: 18000,
    salaryMaxAed: 40000,
    outlook: "emerging",
    uaeDemand: 4,
  },
  {
    key: "mechanical_engineer",
    title: { en: "Mechanical Engineer", ar: "مهندس ميكانيكي" },
    cluster: ENG,
    summary: {
      en: "Designs machines and mechanical systems, from air-conditioning plants to car engines and manufacturing equipment.",
      ar: "يصمّم الآلات والأنظمة الميكانيكية، من محطات التكييف إلى محركات السيارات ومعدات التصنيع.",
    },
    dayInLife: {
      en: "You may run computer simulations of a new part, visit a site to inspect equipment and write a report on how to improve efficiency.",
      ar: "قد تجري محاكاة حاسوبية لقطعة جديدة، وتزور موقعًا لفحص المعدات، وتكتب تقريرًا عن سبل رفع الكفاءة.",
    },
    weights: w(5, 1, 4, 3, 2, 1, 2, 5, 3),
    subjects: ["MATH", "PHYS", "DT"],
    skills: {
      en: ["Computer-aided design", "Physics and mechanics", "Problem solving", "Project management"],
      ar: ["التصميم بمساعدة الحاسوب", "الفيزياء والميكانيكا", "حل المشكلات", "إدارة المشاريع"],
    },
    education: {
      en: "A bachelor's in mechanical engineering, offered at Khalifa University, AUS, UAE University and Heriot-Watt Dubai.",
      ar: "بكالوريوس في الهندسة الميكانيكية، ويُطرح في جامعة خليفة والجامعة الأمريكية في الشارقة وجامعة الإمارات وجامعة هيريوت وات دبي.",
    },
    salaryMinAed: 12000,
    salaryMaxAed: 30000,
    outlook: "stable",
    uaeDemand: 3,
  },
  {
    key: "civil_engineer",
    title: { en: "Civil Engineer", ar: "مهندس مدني" },
    cluster: ENG,
    summary: {
      en: "Plans and oversees the construction of buildings, bridges, roads, tunnels and water networks.",
      ar: "يخطط لإنشاء المباني والجسور والطرق والأنفاق وشبكات المياه ويشرف على تنفيذها.",
    },
    dayInLife: {
      en: "You might check structural calculations in the morning and spend the afternoon on a construction site meeting contractors.",
      ar: "قد تراجع الحسابات الإنشائية صباحًا، ثم تقضي فترة ما بعد الظهر في موقع البناء مجتمعًا بالمقاولين.",
    },
    weights: w(4, 2, 5, 2, 2, 2, 3, 4, 4),
    subjects: ["MATH", "PHYS", "GEO"],
    skills: {
      en: ["Structural analysis", "Site management", "Spatial reasoning", "Safety awareness"],
      ar: ["التحليل الإنشائي", "إدارة المواقع", "الاستدلال المكاني", "الوعي بمعايير السلامة"],
    },
    education: {
      en: "A bachelor's in civil engineering, available at UAE University, University of Sharjah, AUS and Abu Dhabi University.",
      ar: "بكالوريوس في الهندسة المدنية، ويُتاح في جامعة الإمارات وجامعة الشارقة والجامعة الأمريكية في الشارقة وجامعة أبوظبي.",
    },
    salaryMinAed: 12000,
    salaryMaxAed: 32000,
    outlook: "stable",
    uaeDemand: 3,
  },
  {
    key: "electrical_engineer",
    title: { en: "Electrical Engineer", ar: "مهندس كهربائي" },
    cluster: ENG,
    summary: {
      en: "Designs and maintains electrical systems, from power grids and smart buildings to microchips and communication networks.",
      ar: "يصمّم الأنظمة الكهربائية ويصونها، من شبكات الطاقة والمباني الذكية إلى الرقائق الإلكترونية وشبكات الاتصالات.",
    },
    dayInLife: {
      en: "Your day may include designing a circuit, testing equipment in a lab and working with a utility team to upgrade part of the grid.",
      ar: "قد يتضمن يومك تصميم دائرة كهربائية، واختبار المعدات في المختبر، والعمل مع فريق شركة المرافق لتحديث جزء من الشبكة.",
    },
    weights: w(5, 1, 3, 4, 2, 1, 2, 5, 4),
    subjects: ["MATH", "PHYS", "CS"],
    skills: {
      en: ["Circuit design", "Mathematics", "Testing and measurement", "Safety standards"],
      ar: ["تصميم الدوائر", "الرياضيات", "الاختبار والقياس", "معايير السلامة"],
    },
    education: {
      en: "A bachelor's in electrical or electronic engineering, offered at Khalifa University, AUS, RIT Dubai and UAE University.",
      ar: "بكالوريوس في الهندسة الكهربائية أو الإلكترونية، ويُطرح في جامعة خليفة والجامعة الأمريكية في الشارقة ومعهد روتشستر في دبي وجامعة الإمارات.",
    },
    salaryMinAed: 13000,
    salaryMaxAed: 32000,
    outlook: "stable",
    uaeDemand: 4,
  },
  {
    key: "aerospace_engineer",
    title: { en: "Aerospace Engineer", ar: "مهندس طيران وفضاء" },
    cluster: ENG,
    summary: {
      en: "Designs, tests and maintains aircraft, satellites and spacecraft, including projects like the UAE's Mars and lunar missions.",
      ar: "يصمّم الطائرات والأقمار الصناعية والمركبات الفضائية ويختبرها ويصونها، ومنها مشاريع مثل مهمات الإمارات إلى المريخ والقمر.",
    },
    dayInLife: {
      en: "You could analyse wind tunnel data, model a satellite component and join a review meeting before a test launch.",
      ar: "قد تحلّل بيانات نفق الرياح، وتنمذج أحد مكوّنات قمر صناعي، وتشارك في اجتماع مراجعة قبل إطلاق تجريبي.",
    },
    weights: w(5, 1, 5, 5, 3, 1, 1, 5, 4),
    subjects: ["MATH", "PHYS", "CS"],
    skills: {
      en: ["Aerodynamics", "Advanced mathematics", "Simulation software", "Precision"],
      ar: ["الديناميكا الهوائية", "الرياضيات المتقدمة", "برامج المحاكاة", "الدقة المتناهية"],
    },
    education: {
      en: "A degree in aerospace or mechanical engineering; Khalifa University offers aerospace engineering and works closely with the Mohammed Bin Rashid Space Centre.",
      ar: "شهادة في هندسة الطيران والفضاء أو الهندسة الميكانيكية، وتطرح جامعة خليفة تخصص هندسة الطيران والفضاء بالتعاون الوثيق مع مركز محمد بن راشد للفضاء.",
    },
    salaryMinAed: 18000,
    salaryMaxAed: 42000,
    outlook: "growing",
    uaeDemand: 4,
  },
  {
    key: "architect",
    title: { en: "Architect", ar: "مهندس معماري" },
    cluster: ENG,
    summary: {
      en: "Designs buildings and spaces that are beautiful, safe and practical, balancing creativity with engineering and sustainability.",
      ar: "يصمّم المباني والمساحات لتكون جميلة وآمنة وعملية، موازنًا بين الإبداع والاعتبارات الهندسية ومتطلبات الاستدامة.",
    },
    dayInLife: {
      en: "You might sketch concepts with a client, refine a 3D model on the computer and visit a site to check the design is being built correctly.",
      ar: "قد ترسم أفكارًا أولية مع العميل، ثم تطوّر نموذجًا ثلاثي الأبعاد على الحاسوب، وتزور الموقع للتأكد من تنفيذ التصميم كما يجب.",
    },
    weights: w(3, 3, 5, 2, 5, 2, 3, 3, 3),
    subjects: ["ART", "MATH", "DT", "PHYS"],
    skills: {
      en: ["Drawing and 3D modelling", "Spatial design", "Client communication", "Sustainable design"],
      ar: ["الرسم والنمذجة ثلاثية الأبعاد", "التصميم المكاني", "التواصل مع العملاء", "التصميم المستدام"],
    },
    education: {
      en: "A five-year architecture degree, offered at AUS, University of Sharjah and Abu Dhabi University, followed by professional licensing.",
      ar: "شهادة في العمارة مدتها خمس سنوات، تُطرح في الجامعة الأمريكية في الشارقة وجامعة الشارقة وجامعة أبوظبي، يعقبها الحصول على الترخيص المهني.",
    },
    salaryMinAed: 14000,
    salaryMaxAed: 35000,
    outlook: "stable",
    uaeDemand: 3,
  },

  // ---------------- Health ----------------
  {
    key: "doctor",
    title: { en: "Medical Doctor", ar: "طبيب" },
    cluster: HEALTH,
    summary: {
      en: "Diagnoses and treats illness and injury, and helps patients stay healthy through prevention and ongoing care.",
      ar: "يشخّص الأمراض والإصابات ويعالجها، ويساعد المرضى على الحفاظ على صحتهم من خلال الوقاية والمتابعة المستمرة.",
    },
    dayInLife: {
      en: "A day may include ward rounds, seeing patients in clinic, reviewing test results and discussing complex cases with colleagues.",
      ar: "قد يشمل اليوم جولات على الأقسام، واستقبال المرضى في العيادة، ومراجعة نتائج الفحوصات، ومناقشة الحالات المعقدة مع الزملاء.",
    },
    weights: w(4, 4, 2, 5, 1, 5, 2, 3, 4),
    subjects: ["BIO", "CHEM", "MATH", "PHYS"],
    skills: {
      en: ["Scientific knowledge", "Empathy", "Decision making", "Communication"],
      ar: ["المعرفة العلمية", "التعاطف", "اتخاذ القرار", "التواصل"],
    },
    education: {
      en: "A six-year medical degree (MBBS or MD) followed by residency; UAE options include UAE University, Khalifa University and the University of Sharjah.",
      ar: "شهادة في الطب مدتها ست سنوات يتبعها برنامج الإقامة الطبية، ومن الخيارات في الدولة جامعة الإمارات وجامعة خليفة وجامعة الشارقة.",
    },
    salaryMinAed: 30000,
    salaryMaxAed: 90000,
    outlook: "growing",
    uaeDemand: 5,
  },
  {
    key: "pharmacist",
    title: { en: "Pharmacist", ar: "صيدلاني" },
    cluster: HEALTH,
    summary: {
      en: "Makes sure patients receive the right medicines at the right doses, and advises them and doctors on safe use.",
      ar: "يتأكد من حصول المرضى على الأدوية الصحيحة بالجرعات المناسبة، ويقدّم المشورة لهم وللأطباء حول الاستخدام الآمن.",
    },
    dayInLife: {
      en: "You might check prescriptions for interactions, counsel patients on how to take their medication and manage stock in a hospital pharmacy.",
      ar: "قد تراجع الوصفات للتحقق من التداخلات الدوائية، وترشد المرضى إلى طريقة تناول أدويتهم، وتدير المخزون في صيدلية المستشفى.",
    },
    weights: w(4, 3, 1, 4, 1, 4, 2, 3, 5),
    subjects: ["CHEM", "BIO", "MATH"],
    skills: {
      en: ["Chemistry", "Accuracy", "Patient counselling", "Ethics"],
      ar: ["الكيمياء", "الدقة", "تقديم المشورة للمرضى", "الأخلاقيات المهنية"],
    },
    education: {
      en: "A bachelor's or Doctor of Pharmacy degree, offered at the University of Sharjah, Abu Dhabi University and other UAE institutions, plus licensing.",
      ar: "بكالوريوس الصيدلة أو دكتور صيدلة، ويُطرح في جامعة الشارقة وجامعة أبوظبي ومؤسسات أخرى في الدولة، إضافة إلى الترخيص المهني.",
    },
    salaryMinAed: 14000,
    salaryMaxAed: 28000,
    outlook: "stable",
    uaeDemand: 3,
  },
  {
    key: "nurse",
    title: { en: "Registered Nurse", ar: "ممرض مسجّل" },
    cluster: HEALTH,
    summary: {
      en: "Provides hands-on care for patients, monitors their condition and supports families during treatment and recovery.",
      ar: "يقدّم الرعاية المباشرة للمرضى، ويتابع حالتهم الصحية، ويساند أسرهم خلال فترة العلاج والتعافي.",
    },
    dayInLife: {
      en: "Your shift may include giving medication, checking vital signs, updating records and reassuring a worried patient before surgery.",
      ar: "قد تشمل مناوبتك إعطاء الأدوية، وقياس العلامات الحيوية، وتحديث السجلات، وطمأنة مريض قلق قبل العملية الجراحية.",
    },
    weights: w(2, 3, 1, 3, 1, 5, 1, 4, 4),
    subjects: ["BIO", "CHEM", "PSY"],
    skills: {
      en: ["Compassion", "Clinical skills", "Teamwork", "Resilience"],
      ar: ["الرحمة والاهتمام", "المهارات السريرية", "العمل الجماعي", "المرونة والتحمّل"],
    },
    education: {
      en: "A bachelor's in nursing, available at the University of Sharjah, Fatima College of Health Sciences and other UAE colleges, followed by licensing.",
      ar: "بكالوريوس في التمريض، ويُتاح في جامعة الشارقة وكلية فاطمة للعلوم الصحية وكليات أخرى في الدولة، يتبعه الترخيص المهني.",
    },
    salaryMinAed: 9000,
    salaryMaxAed: 22000,
    outlook: "growing",
    uaeDemand: 5,
  },
  {
    key: "dentist",
    title: { en: "Dentist", ar: "طبيب أسنان" },
    cluster: HEALTH,
    summary: {
      en: "Prevents, diagnoses and treats problems of the teeth and mouth, combining medical knowledge with fine manual skill.",
      ar: "يقي من مشكلات الأسنان والفم ويشخّصها ويعالجها، جامعًا بين المعرفة الطبية والمهارة اليدوية الدقيقة.",
    },
    dayInLife: {
      en: "You might carry out check-ups, fill cavities, plan a brace treatment and explain good oral hygiene to a young patient.",
      ar: "قد تجري فحوصات دورية، وتعالج التسوّس، وتخطط لعلاج تقويم الأسنان، وتشرح لمريض صغير أسس العناية بالفم.",
    },
    weights: w(3, 3, 4, 4, 2, 4, 3, 5, 4),
    subjects: ["BIO", "CHEM", "PHYS"],
    skills: {
      en: ["Manual dexterity", "Patient care", "Precision", "Science knowledge"],
      ar: ["المهارة اليدوية", "رعاية المرضى", "الدقة", "المعرفة العلمية"],
    },
    education: {
      en: "A five to six year dental degree; the University of Sharjah and Ajman University offer dentistry in the UAE.",
      ar: "شهادة في طب الأسنان مدتها خمس إلى ست سنوات، وتطرحها في الدولة جامعة الشارقة وجامعة عجمان.",
    },
    salaryMinAed: 20000,
    salaryMaxAed: 55000,
    outlook: "stable",
    uaeDemand: 3,
  },
  {
    key: "physiotherapist",
    title: { en: "Physiotherapist", ar: "أخصائي علاج طبيعي" },
    cluster: HEALTH,
    summary: {
      en: "Helps people recover movement and strength after injury, surgery or illness through exercise and hands-on therapy.",
      ar: "يساعد الأشخاص على استعادة الحركة والقوة بعد الإصابة أو الجراحة أو المرض من خلال التمارين والعلاج اليدوي.",
    },
    dayInLife: {
      en: "You could assess an athlete's knee injury, guide an older patient through balance exercises and track progress in treatment plans.",
      ar: "قد تقيّم إصابة في ركبة أحد الرياضيين، وتوجّه مريضًا مسنًّا في تمارين التوازن، وتتابع التقدّم في الخطط العلاجية.",
    },
    weights: w(2, 3, 3, 3, 2, 5, 2, 4, 3),
    subjects: ["BIO", "PE", "PSY"],
    skills: {
      en: ["Anatomy", "Motivating others", "Hands-on therapy", "Listening"],
      ar: ["علم التشريح", "تحفيز الآخرين", "العلاج اليدوي", "الإصغاء الجيد"],
    },
    education: {
      en: "A bachelor's in physiotherapy, offered at the University of Sharjah, Gulf Medical University and other UAE institutions.",
      ar: "بكالوريوس في العلاج الطبيعي، ويُطرح في جامعة الشارقة وجامعة الخليج الطبية ومؤسسات أخرى في الدولة.",
    },
    salaryMinAed: 10000,
    salaryMaxAed: 25000,
    outlook: "growing",
    uaeDemand: 4,
  },
  {
    key: "psychologist",
    title: { en: "Psychologist", ar: "أخصائي نفسي" },
    cluster: HEALTH,
    summary: {
      en: "Studies how people think, feel and behave, and supports individuals and families in improving their mental wellbeing.",
      ar: "يدرس طريقة تفكير الناس ومشاعرهم وسلوكهم، ويدعم الأفراد والأسر في تحسين صحتهم النفسية.",
    },
    dayInLife: {
      en: "You might hold counselling sessions, carry out an assessment, write up clinical notes and deliver a wellbeing workshop.",
      ar: "قد تعقد جلسات إرشادية، وتجري تقييمًا نفسيًا، وتدوّن الملاحظات السريرية، وتقدّم ورشة عن جودة الحياة والصحة النفسية.",
    },
    weights: w(3, 5, 1, 4, 2, 5, 1, 1, 3),
    subjects: ["PSY", "BIO", "ENG"],
    skills: {
      en: ["Active listening", "Empathy", "Research methods", "Confidentiality"],
      ar: ["الإصغاء الفعّال", "التعاطف", "مناهج البحث", "الحفاظ على السرية"],
    },
    education: {
      en: "A psychology degree followed by a master's or doctorate in clinical or counselling psychology; Zayed University and Heriot-Watt Dubai offer psychology.",
      ar: "بكالوريوس في علم النفس يتبعه ماجستير أو دكتوراه في علم النفس الإكلينيكي أو الإرشادي، وتطرح جامعة زايد وجامعة هيريوت وات دبي تخصص علم النفس.",
    },
    salaryMinAed: 14000,
    salaryMaxAed: 32000,
    outlook: "growing",
    uaeDemand: 4,
  },
  {
    key: "veterinarian",
    title: { en: "Veterinarian", ar: "طبيب بيطري" },
    cluster: HEALTH,
    summary: {
      en: "Cares for the health of animals, from family pets to camels, falcons and horses, and helps protect public health.",
      ar: "يرعى صحة الحيوانات، من الحيوانات الأليفة إلى الإبل والصقور والخيول، ويسهم في حماية الصحة العامة.",
    },
    dayInLife: {
      en: "You may vaccinate pets in the morning, perform a minor surgery and later visit a farm or falcon hospital.",
      ar: "قد تطعّم الحيوانات الأليفة صباحًا، وتجري عملية جراحية بسيطة، ثم تزور مزرعة أو مستشفى للصقور.",
    },
    weights: w(3, 2, 2, 5, 1, 4, 2, 4, 3),
    subjects: ["BIO", "CHEM"],
    skills: {
      en: ["Animal care", "Diagnosis", "Surgery skills", "Communication with owners"],
      ar: ["رعاية الحيوانات", "التشخيص", "المهارات الجراحية", "التواصل مع أصحاب الحيوانات"],
    },
    education: {
      en: "A five-year veterinary medicine degree; UAE University offers veterinary medicine in Al Ain.",
      ar: "شهادة في الطب البيطري مدتها خمس سنوات، وتطرحها جامعة الإمارات في مدينة العين.",
    },
    salaryMinAed: 15000,
    salaryMaxAed: 35000,
    outlook: "stable",
    uaeDemand: 2,
  },

  // ---------------- Science ----------------
  {
    key: "biomedical_scientist",
    title: { en: "Biomedical Scientist", ar: "عالم طب حيوي" },
    cluster: SCI,
    summary: {
      en: "Researches diseases and tests samples in the lab to help develop new treatments, vaccines and diagnostic tools.",
      ar: "يبحث في الأمراض ويحلّل العيّنات في المختبر للمساعدة في تطوير علاجات ولقاحات وأدوات تشخيص جديدة.",
    },
    dayInLife: {
      en: "You might run DNA analysis, record results carefully, read the latest research papers and share findings with doctors.",
      ar: "قد تجري تحليلًا للحمض النووي، وتسجّل النتائج بعناية، وتطّلع على أحدث الأوراق البحثية، وتشارك النتائج مع الأطباء.",
    },
    weights: w(4, 2, 2, 5, 2, 2, 1, 4, 5),
    subjects: ["BIO", "CHEM", "MATH"],
    skills: {
      en: ["Laboratory techniques", "Data analysis", "Scientific writing", "Patience"],
      ar: ["التقنيات المخبرية", "تحليل البيانات", "الكتابة العلمية", "الصبر"],
    },
    education: {
      en: "A degree in biomedical science, biology or biotechnology, with research paths at Khalifa University and NYU Abu Dhabi.",
      ar: "شهادة في العلوم الطبية الحيوية أو الأحياء أو التقنية الحيوية، مع مسارات بحثية في جامعة خليفة وجامعة نيويورك أبوظبي.",
    },
    salaryMinAed: 12000,
    salaryMaxAed: 28000,
    outlook: "growing",
    uaeDemand: 4,
  },
  {
    key: "environmental_scientist",
    title: { en: "Environmental Scientist", ar: "عالم بيئة" },
    cluster: SCI,
    summary: {
      en: "Studies air, water, soil and ecosystems to understand pollution and climate change and to protect natural resources.",
      ar: "يدرس الهواء والماء والتربة والنظم البيئية لفهم التلوث والتغيّر المناخي وحماية الموارد الطبيعية.",
    },
    dayInLife: {
      en: "You could collect samples in the desert or along the coast, analyse them in the lab and advise a company on reducing its impact.",
      ar: "قد تجمع العيّنات من الصحراء أو الساحل، وتحلّلها في المختبر، وتقدّم المشورة لإحدى الشركات لتقليل أثرها البيئي.",
    },
    weights: w(4, 3, 3, 5, 2, 3, 2, 3, 3),
    subjects: ["BIO", "CHEM", "GEO"],
    skills: {
      en: ["Fieldwork", "Data analysis", "Report writing", "Environmental law awareness"],
      ar: ["العمل الميداني", "تحليل البيانات", "كتابة التقارير", "الإلمام بالتشريعات البيئية"],
    },
    education: {
      en: "A degree in environmental science, chemistry or geography; UAE University and the University of Sharjah run environmental programmes.",
      ar: "شهادة في علوم البيئة أو الكيمياء أو الجغرافيا، وتطرح جامعة الإمارات وجامعة الشارقة برامج في هذا المجال.",
    },
    salaryMinAed: 12000,
    salaryMaxAed: 28000,
    outlook: "growing",
    uaeDemand: 4,
  },
  {
    key: "marine_biologist",
    title: { en: "Marine Biologist", ar: "عالم أحياء بحرية" },
    cluster: SCI,
    summary: {
      en: "Studies sea life and ocean ecosystems, including the coral reefs, mangroves and dugongs of the Arabian Gulf.",
      ar: "يدرس الكائنات البحرية والنظم البيئية في المحيطات، ومنها الشعاب المرجانية وأشجار القرم وأبقار البحر في الخليج العربي.",
    },
    dayInLife: {
      en: "You might dive to survey a reef, tag turtles for tracking and spend the afternoon analysing data from your fieldwork.",
      ar: "قد تغوص لمسح إحدى الشعاب المرجانية، وتثبّت أجهزة تتبّع على السلاحف، ثم تقضي فترة ما بعد الظهر في تحليل بيانات عملك الميداني.",
    },
    weights: w(3, 2, 2, 5, 2, 2, 1, 3, 3),
    subjects: ["BIO", "CHEM", "GEO"],
    skills: {
      en: ["Field research", "Diving", "Observation", "Scientific reporting"],
      ar: ["البحث الميداني", "الغوص", "الملاحظة الدقيقة", "إعداد التقارير العلمية"],
    },
    education: {
      en: "A degree in marine biology or biology, with research opportunities at NYU Abu Dhabi, UAE University and the Environment Agency Abu Dhabi.",
      ar: "شهادة في الأحياء البحرية أو علم الأحياء، مع فرص بحثية في جامعة نيويورك أبوظبي وجامعة الإمارات وهيئة البيئة في أبوظبي.",
    },
    salaryMinAed: 10000,
    salaryMaxAed: 25000,
    outlook: "stable",
    uaeDemand: 2,
  },
  {
    key: "chemist",
    title: { en: "Chemist", ar: "كيميائي" },
    cluster: SCI,
    summary: {
      en: "Investigates substances and reactions to create new materials, medicines, fuels and cleaner industrial processes.",
      ar: "يدرس المواد والتفاعلات الكيميائية لابتكار مواد وأدوية ووقود جديدة وعمليات صناعية أنظف.",
    },
    dayInLife: {
      en: "Your day could include planning experiments, operating lab instruments, analysing results and writing up quality reports.",
      ar: "قد يتضمن يومك تخطيط التجارب، وتشغيل الأجهزة المخبرية، وتحليل النتائج، وإعداد تقارير الجودة.",
    },
    weights: w(4, 2, 2, 5, 2, 1, 1, 4, 5),
    subjects: ["CHEM", "MATH", "PHYS"],
    skills: {
      en: ["Experimental design", "Lab safety", "Analytical thinking", "Precision"],
      ar: ["تصميم التجارب", "السلامة المخبرية", "التفكير التحليلي", "الدقة"],
    },
    education: {
      en: "A degree in chemistry or chemical engineering, offered at UAE University, Khalifa University and the University of Sharjah.",
      ar: "شهادة في الكيمياء أو الهندسة الكيميائية، وتُطرح في جامعة الإمارات وجامعة خليفة وجامعة الشارقة.",
    },
    salaryMinAed: 11000,
    salaryMaxAed: 26000,
    outlook: "stable",
    uaeDemand: 3,
  },

  // ---------------- Business and Finance ----------------
  {
    key: "accountant",
    title: { en: "Accountant", ar: "محاسب" },
    cluster: BIZ,
    summary: {
      en: "Keeps financial records accurate, prepares reports and helps organisations follow tax and reporting rules such as UAE corporate tax.",
      ar: "يحافظ على دقة السجلات المالية، ويُعدّ التقارير، ويساعد المؤسسات على الالتزام بأنظمة الضرائب وإعداد التقارير، مثل ضريبة الشركات في الدولة.",
    },
    dayInLife: {
      en: "You may reconcile accounts, prepare monthly statements, check VAT returns and explain figures to a manager.",
      ar: "قد تطابق الحسابات، وتُعدّ القوائم المالية الشهرية، وتراجع إقرارات ضريبة القيمة المضافة، وتشرح الأرقام لأحد المديرين.",
    },
    weights: w(5, 2, 1, 2, 1, 2, 2, 2, 5),
    subjects: ["MATH", "BUS", "ECON"],
    skills: {
      en: ["Numeracy", "Attention to detail", "Spreadsheets", "Integrity"],
      ar: ["الكفاءة الحسابية", "الانتباه للتفاصيل", "جداول البيانات", "النزاهة"],
    },
    education: {
      en: "A degree in accounting or finance followed by a professional qualification such as ACCA or CPA.",
      ar: "شهادة في المحاسبة أو المالية يتبعها مؤهل مهني مثل ACCA أو CPA.",
    },
    salaryMinAed: 10000,
    salaryMaxAed: 28000,
    outlook: "stable",
    uaeDemand: 3,
  },
  {
    key: "financial_analyst",
    title: { en: "Financial Analyst", ar: "محلل مالي" },
    cluster: BIZ,
    summary: {
      en: "Studies markets and company performance to guide investment decisions for banks, funds and businesses.",
      ar: "يدرس الأسواق وأداء الشركات لتوجيه قرارات الاستثمار لدى البنوك والصناديق والشركات.",
    },
    dayInLife: {
      en: "You might build a financial model, follow market news, write an investment note and present your view to a portfolio team.",
      ar: "قد تبني نموذجًا ماليًا، وتتابع أخبار الأسواق، وتكتب مذكرة استثمارية، وتعرض رأيك على فريق إدارة المحافظ.",
    },
    weights: w(5, 3, 1, 4, 1, 2, 4, 2, 4),
    subjects: ["MATH", "ECON", "BUS"],
    skills: {
      en: ["Financial modelling", "Critical thinking", "Presentation", "Market awareness"],
      ar: ["النمذجة المالية", "التفكير النقدي", "مهارات العرض", "الإلمام بالأسواق"],
    },
    education: {
      en: "A degree in finance, economics or mathematics, often followed by the CFA qualification; AUS and NYU Abu Dhabi are popular local routes.",
      ar: "شهادة في المالية أو الاقتصاد أو الرياضيات، يتبعها غالبًا مؤهل المحلل المالي المعتمد CFA، ومن المسارات المحلية الشائعة الجامعة الأمريكية في الشارقة وجامعة نيويورك أبوظبي.",
    },
    salaryMinAed: 15000,
    salaryMaxAed: 40000,
    outlook: "growing",
    uaeDemand: 4,
  },
  {
    key: "entrepreneur",
    title: { en: "Entrepreneur", ar: "رائد أعمال" },
    cluster: BIZ,
    summary: {
      en: "Turns an idea into a business, taking responsibility for the product, the team, the customers and the risk.",
      ar: "يحوّل الفكرة إلى مشروع قائم، ويتحمّل مسؤولية المنتج والفريق والعملاء والمخاطر.",
    },
    dayInLife: {
      en: "One day you might pitch to investors, the next you might hire a developer, talk to customers and rethink your pricing.",
      ar: "قد تعرض مشروعك على المستثمرين في يوم، وفي اليوم التالي توظّف مطوّرًا وتتحدث مع العملاء وتعيد النظر في سياسة التسعير.",
    },
    weights: w(3, 4, 2, 3, 4, 3, 5, 2, 3),
    subjects: ["BUS", "ECON", "ENG"],
    skills: {
      en: ["Leadership", "Resilience", "Sales and negotiation", "Creative thinking"],
      ar: ["القيادة", "المثابرة", "البيع والتفاوض", "التفكير الإبداعي"],
    },
    education: {
      en: "No single route; a business or technical degree helps, and UAE programmes such as Hub71 and in5 support young founders.",
      ar: "لا يوجد مسار واحد، لكن الشهادة في الأعمال أو في تخصص تقني تفيد كثيرًا، وتدعم برامج إماراتية مثل Hub71 وin5 روّاد الأعمال الشباب.",
    },
    salaryMinAed: 10000,
    salaryMaxAed: 80000,
    outlook: "growing",
    uaeDemand: 5,
  },
  {
    key: "marketing_manager",
    title: { en: "Marketing Manager", ar: "مدير تسويق" },
    cluster: BIZ,
    summary: {
      en: "Plans campaigns that build a brand and attract customers, using research, creative content and digital analytics.",
      ar: "يخطط للحملات التي تبني العلامة التجارية وتجذب العملاء، مستعينًا بالأبحاث والمحتوى الإبداعي والتحليلات الرقمية.",
    },
    dayInLife: {
      en: "You might review social media results, brief a design agency, meet the sales team and adjust the budget for a product launch.",
      ar: "قد تراجع نتائج وسائل التواصل الاجتماعي، وتوجّه وكالة تصميم، وتجتمع بفريق المبيعات، وتعدّل ميزانية إطلاق منتج جديد.",
    },
    weights: w(3, 5, 2, 2, 4, 4, 5, 1, 3),
    subjects: ["BUS", "ENG", "PSY", "ARAB"],
    skills: {
      en: ["Storytelling", "Digital marketing", "Consumer insight", "Budgeting"],
      ar: ["سرد القصص", "التسويق الرقمي", "فهم سلوك المستهلك", "إعداد الميزانيات"],
    },
    education: {
      en: "A degree in marketing, business or communication, offered widely at Zayed University, University of Wollongong in Dubai and Middlesex Dubai.",
      ar: "شهادة في التسويق أو إدارة الأعمال أو الاتصال، وتُطرح على نطاق واسع في جامعة زايد وجامعة ولونغونغ في دبي وجامعة ميدلسكس دبي.",
    },
    salaryMinAed: 18000,
    salaryMaxAed: 45000,
    outlook: "stable",
    uaeDemand: 3,
  },
  {
    key: "supply_chain_manager",
    title: { en: "Supply Chain Manager", ar: "مدير سلاسل الإمداد" },
    cluster: BIZ,
    summary: {
      en: "Makes sure goods move efficiently from suppliers to customers, a key role in a global trade hub like the UAE.",
      ar: "يضمن انتقال البضائع بكفاءة من الموردين إلى العملاء، وهو دور محوري في مركز تجاري عالمي مثل دولة الإمارات.",
    },
    dayInLife: {
      en: "You may track shipments through Jebel Ali, solve a delivery delay, negotiate with a supplier and plan stock for the next quarter.",
      ar: "قد تتابع الشحنات عبر ميناء جبل علي، وتعالج تأخيرًا في التسليم، وتتفاوض مع أحد الموردين، وتخطط للمخزون في الربع القادم.",
    },
    weights: w(4, 3, 3, 2, 1, 3, 4, 2, 5),
    subjects: ["MATH", "BUS", "ECON", "GEO"],
    skills: {
      en: ["Planning", "Negotiation", "Data analysis", "Problem solving"],
      ar: ["التخطيط", "التفاوض", "تحليل البيانات", "حل المشكلات"],
    },
    education: {
      en: "A degree in logistics, business or industrial engineering; Heriot-Watt Dubai and the University of Wollongong in Dubai offer related programmes.",
      ar: "شهادة في الخدمات اللوجستية أو إدارة الأعمال أو الهندسة الصناعية، وتطرح جامعة هيريوت وات دبي وجامعة ولونغونغ في دبي برامج ذات صلة.",
    },
    salaryMinAed: 16000,
    salaryMaxAed: 40000,
    outlook: "growing",
    uaeDemand: 4,
  },
  {
    key: "economist",
    title: { en: "Economist", ar: "خبير اقتصادي" },
    cluster: BIZ,
    summary: {
      en: "Analyses how money, resources and policies affect people and markets, and advises governments and companies.",
      ar: "يحلّل تأثير المال والموارد والسياسات في الناس والأسواق، ويقدّم المشورة للحكومات والشركات.",
    },
    dayInLife: {
      en: "You could study trade data, forecast inflation, write a policy brief and discuss your findings with senior officials.",
      ar: "قد تدرس بيانات التجارة، وتتنبأ بمعدلات التضخم، وتكتب موجزًا للسياسات، وتناقش نتائجك مع كبار المسؤولين.",
    },
    weights: w(5, 4, 1, 5, 2, 2, 3, 1, 4),
    subjects: ["ECON", "MATH", "HIST"],
    skills: {
      en: ["Statistics", "Research", "Clear writing", "Big-picture thinking"],
      ar: ["الإحصاء", "البحث", "الكتابة الواضحة", "النظرة الشمولية"],
    },
    education: {
      en: "A degree in economics followed by a master's; NYU Abu Dhabi, Sorbonne Abu Dhabi and UAE University all offer economics.",
      ar: "بكالوريوس في الاقتصاد يتبعه ماجستير، وتطرح جامعة نيويورك أبوظبي وجامعة السوربون أبوظبي وجامعة الإمارات هذا التخصص.",
    },
    salaryMinAed: 18000,
    salaryMaxAed: 45000,
    outlook: "stable",
    uaeDemand: 3,
  },

  // ---------------- Creative and Media ----------------
  {
    key: "graphic_designer",
    title: { en: "Graphic Designer", ar: "مصمم جرافيك" },
    cluster: MEDIA,
    summary: {
      en: "Creates visual designs for brands, posters, websites and packaging that communicate ideas clearly and attractively.",
      ar: "يبتكر التصاميم البصرية للعلامات التجارية والملصقات والمواقع الإلكترونية والعبوات لإيصال الأفكار بوضوح وجاذبية.",
    },
    dayInLife: {
      en: "You might sketch logo ideas, design a campaign in Arabic and English, gather feedback and prepare final files for print.",
      ar: "قد ترسم أفكارًا لشعار ما، وتصمّم حملة باللغتين العربية والإنجليزية، وتجمع الملاحظات، وتجهّز الملفات النهائية للطباعة.",
    },
    weights: w(1, 2, 5, 1, 5, 2, 2, 3, 3),
    subjects: ["ART", "DT"],
    skills: {
      en: ["Typography", "Design software", "Visual storytelling", "Taking feedback"],
      ar: ["فن الخط والطباعة", "برامج التصميم", "السرد البصري", "تقبّل الملاحظات"],
    },
    education: {
      en: "A degree or diploma in graphic or visual communication design; AUS, Zayed University and several Dubai colleges offer these programmes.",
      ar: "شهادة أو دبلوم في التصميم الجرافيكي أو الاتصال البصري، وتطرح الجامعة الأمريكية في الشارقة وجامعة زايد وعدة كليات في دبي هذه البرامج.",
    },
    salaryMinAed: 8000,
    salaryMaxAed: 20000,
    outlook: "stable",
    uaeDemand: 2,
  },
  {
    key: "ux_designer",
    title: { en: "UX Designer", ar: "مصمم تجربة المستخدم" },
    cluster: MEDIA,
    summary: {
      en: "Makes apps and websites easy and enjoyable to use by researching users and designing clear, accessible interfaces.",
      ar: "يجعل التطبيقات والمواقع سهلة وممتعة في الاستخدام من خلال دراسة احتياجات المستخدمين وتصميم واجهات واضحة ومتاحة للجميع.",
    },
    dayInLife: {
      en: "You could interview users, sketch wireframes, build a clickable prototype and test it with real people before developers build it.",
      ar: "قد تجري مقابلات مع المستخدمين، وترسم مخططات أولية، وتبني نموذجًا تفاعليًا، وتختبره مع أشخاص حقيقيين قبل أن يبدأ المطوّرون في تنفيذه.",
    },
    weights: w(3, 3, 4, 4, 5, 4, 2, 3, 3),
    subjects: ["ART", "CS", "PSY", "DT"],
    skills: {
      en: ["User research", "Prototyping", "Empathy", "Visual design"],
      ar: ["أبحاث المستخدمين", "بناء النماذج الأولية", "التعاطف", "التصميم البصري"],
    },
    education: {
      en: "A degree in design, psychology or computer science plus a strong portfolio; short UX courses are common in the UAE.",
      ar: "شهادة في التصميم أو علم النفس أو علوم الحاسوب مع ملف أعمال قوي، وتنتشر في الدولة الدورات القصيرة في تصميم تجربة المستخدم.",
    },
    salaryMinAed: 14000,
    salaryMaxAed: 35000,
    outlook: "growing",
    uaeDemand: 4,
  },
  {
    key: "game_designer",
    title: { en: "Game Designer", ar: "مصمم ألعاب إلكترونية" },
    cluster: MEDIA,
    summary: {
      en: "Invents the rules, stories, levels and characters of video games, working with artists and programmers to bring them to life.",
      ar: "يبتكر قواعد الألعاب الإلكترونية وقصصها ومراحلها وشخصياتها، ويعمل مع الفنانين والمبرمجين لتحويلها إلى واقع.",
    },
    dayInLife: {
      en: "You might design a new level, playtest it with the team, balance the difficulty and write notes for the programmers.",
      ar: "قد تصمّم مرحلة جديدة، وتجرّبها مع الفريق، وتضبط مستوى صعوبتها، وتكتب ملاحظات للمبرمجين.",
    },
    weights: w(3, 3, 4, 2, 5, 2, 2, 4, 2),
    subjects: ["CS", "ART", "MATH"],
    skills: {
      en: ["Creativity", "Game engines", "Storytelling", "Teamwork"],
      ar: ["الإبداع", "محركات الألعاب", "سرد القصص", "العمل الجماعي"],
    },
    education: {
      en: "A degree in game design, computer science or digital media; Abu Dhabi's gaming strategy is creating new study and job routes.",
      ar: "شهادة في تصميم الألعاب أو علوم الحاسوب أو الوسائط الرقمية، وتفتح استراتيجية أبوظبي لقطاع الألعاب مسارات جديدة للدراسة والعمل.",
    },
    salaryMinAed: 12000,
    salaryMaxAed: 30000,
    outlook: "emerging",
    uaeDemand: 3,
  },
  {
    key: "film_producer",
    title: { en: "Film Producer", ar: "منتج أفلام" },
    cluster: MEDIA,
    summary: {
      en: "Leads film and video projects from idea to screen, managing budgets, teams, schedules and creative decisions.",
      ar: "يقود مشاريع الأفلام والفيديو من الفكرة حتى العرض، ويدير الميزانيات والفرق والجداول الزمنية والقرارات الإبداعية.",
    },
    dayInLife: {
      en: "Your day may include reviewing a script, securing a filming location in Abu Dhabi, managing the crew and checking the edit.",
      ar: "قد يتضمن يومك مراجعة سيناريو، وحجز موقع للتصوير في أبوظبي، وإدارة فريق العمل، ومتابعة مرحلة المونتاج.",
    },
    weights: w(2, 4, 4, 2, 5, 4, 5, 3, 4),
    subjects: ["ENG", "ART", "BUS", "ARAB"],
    skills: {
      en: ["Leadership", "Budgeting", "Storytelling", "Networking"],
      ar: ["القيادة", "إدارة الميزانية", "سرد القصص", "بناء العلاقات المهنية"],
    },
    education: {
      en: "A degree in film, media or communication; NYU Abu Dhabi offers film and new media, and twofour54 supports emerging talent.",
      ar: "شهادة في السينما أو الإعلام أو الاتصال، وتطرح جامعة نيويورك أبوظبي تخصص السينما والوسائط الجديدة، وتدعم twofour54 المواهب الناشئة.",
    },
    salaryMinAed: 12000,
    salaryMaxAed: 45000,
    outlook: "stable",
    uaeDemand: 3,
  },
  {
    key: "journalist",
    title: { en: "Journalist", ar: "صحفي" },
    cluster: MEDIA,
    summary: {
      en: "Researches, verifies and reports news and stories in print, broadcast and digital media.",
      ar: "يبحث في الأخبار والقصص ويتحقق منها وينقلها عبر الصحافة المطبوعة والإذاعة والتلفزيون والإعلام الرقمي.",
    },
    dayInLife: {
      en: "You might attend a morning editorial meeting, interview sources, check facts and file a story before the deadline.",
      ar: "قد تحضر اجتماع التحرير الصباحي، وتجري مقابلات مع المصادر، وتتحقق من المعلومات، وتسلّم قصتك قبل الموعد النهائي.",
    },
    weights: w(2, 5, 1, 4, 4, 4, 3, 1, 3),
    subjects: ["ENG", "ARAB", "HIST"],
    skills: {
      en: ["Writing", "Interviewing", "Fact checking", "Curiosity"],
      ar: ["الكتابة", "إجراء المقابلات", "التحقق من المعلومات", "حب الاستطلاع"],
    },
    education: {
      en: "A degree in journalism, mass communication or English; AUS, Zayed University and the University of Sharjah offer communication programmes.",
      ar: "شهادة في الصحافة أو الإعلام أو اللغة الإنجليزية، وتطرح الجامعة الأمريكية في الشارقة وجامعة زايد وجامعة الشارقة برامج في الاتصال الجماهيري.",
    },
    salaryMinAed: 10000,
    salaryMaxAed: 28000,
    outlook: "stable",
    uaeDemand: 2,
  },
  {
    key: "interior_designer",
    title: { en: "Interior Designer", ar: "مصمم ديكور داخلي" },
    cluster: MEDIA,
    summary: {
      en: "Plans the look and function of indoor spaces such as homes, hotels, offices and schools.",
      ar: "يخطط لمظهر المساحات الداخلية ووظيفتها، مثل المنازل والفنادق والمكاتب والمدارس.",
    },
    dayInLife: {
      en: "You could meet a client, create a mood board, choose materials and lighting and visit a site to oversee fit-out.",
      ar: "قد تلتقي بعميل، وتُعدّ لوحة إلهام، وتختار المواد والإضاءة، وتزور الموقع للإشراف على أعمال التشطيب.",
    },
    weights: w(2, 3, 5, 1, 5, 3, 3, 3, 3),
    subjects: ["ART", "DT"],
    skills: {
      en: ["Space planning", "Colour and materials", "3D visualisation", "Client service"],
      ar: ["تخطيط المساحات", "الألوان والخامات", "التصوّر ثلاثي الأبعاد", "خدمة العملاء"],
    },
    education: {
      en: "A degree in interior design, offered at AUS, Heriot-Watt Dubai, Canadian University Dubai and other UAE institutions.",
      ar: "شهادة في التصميم الداخلي، وتُطرح في الجامعة الأمريكية في الشارقة وجامعة هيريوت وات دبي والجامعة الكندية في دبي ومؤسسات أخرى في الدولة.",
    },
    salaryMinAed: 10000,
    salaryMaxAed: 28000,
    outlook: "stable",
    uaeDemand: 3,
  },
  {
    key: "fashion_designer",
    title: { en: "Fashion Designer", ar: "مصمم أزياء" },
    cluster: MEDIA,
    summary: {
      en: "Creates clothing and accessories, from modest fashion and abayas to sportswear, following trends and building a personal style.",
      ar: "يبتكر الملابس والإكسسوارات، من الأزياء المحتشمة والعباءات إلى الملابس الرياضية، متابعًا الصيحات ومطوّرًا أسلوبه الخاص.",
    },
    dayInLife: {
      en: "You might sketch a collection, choose fabrics, work with a pattern cutter and prepare pieces for a Dubai fashion show.",
      ar: "قد ترسم تصاميم مجموعة جديدة، وتختار الأقمشة، وتعمل مع أخصائي الباترون، وتجهّز القطع لعرض أزياء في دبي.",
    },
    weights: w(1, 2, 4, 1, 5, 2, 4, 4, 2),
    subjects: ["ART", "DT", "BUS"],
    skills: {
      en: ["Drawing", "Sewing and pattern making", "Trend awareness", "Brand building"],
      ar: ["الرسم", "الخياطة وصناعة الباترون", "متابعة الصيحات", "بناء العلامة التجارية"],
    },
    education: {
      en: "A degree in fashion design, available at institutions such as ESMOD Dubai, or study abroad in London, Paris or Milan.",
      ar: "شهادة في تصميم الأزياء، وتُتاح في مؤسسات مثل إسمود دبي، أو من خلال الدراسة في لندن أو باريس أو ميلانو.",
    },
    salaryMinAed: 9000,
    salaryMaxAed: 30000,
    outlook: "stable",
    uaeDemand: 2,
  },

  // ---------------- Education and Social ----------------
  {
    key: "teacher",
    title: { en: "Teacher", ar: "معلّم" },
    cluster: EDU,
    summary: {
      en: "Inspires young people to learn, plans engaging lessons and supports each student's progress and wellbeing.",
      ar: "يلهم الطلبة ويحفّزهم على التعلّم، ويخطط لدروس مشوّقة، ويدعم تقدّم كل طالب وصحته النفسية.",
    },
    dayInLife: {
      en: "You might teach several classes, run a club after school, give feedback on work and meet parents to discuss progress.",
      ar: "قد تدرّس عدة حصص، وتشرف على نادٍ بعد الدوام، وتقدّم ملاحظات على أعمال الطلبة، وتلتقي بأولياء الأمور لمناقشة تقدّم أبنائهم.",
    },
    weights: w(2, 5, 2, 3, 4, 5, 3, 1, 4),
    subjects: ["ENG", "ARAB", "PSY"],
    skills: {
      en: ["Communication", "Patience", "Lesson planning", "Classroom leadership"],
      ar: ["التواصل", "الصبر", "التخطيط للدروس", "إدارة الصف"],
    },
    education: {
      en: "A degree in your teaching subject plus a teaching qualification; Emirates College for Advanced Education and UAE University train teachers locally.",
      ar: "شهادة في المادة التي ستدرّسها مع مؤهل تربوي، وتؤهل كلية الإمارات للتطوير التربوي وجامعة الإمارات المعلمين محليًا.",
    },
    salaryMinAed: 10000,
    salaryMaxAed: 25000,
    outlook: "stable",
    uaeDemand: 4,
  },
  {
    key: "school_counselor",
    title: { en: "School Counselor", ar: "مرشد طلابي" },
    cluster: EDU,
    summary: {
      en: "Supports students with wellbeing, study habits and university and career choices.",
      ar: "يساند الطلبة في صحتهم النفسية وعاداتهم الدراسية وخياراتهم الجامعية والمهنية.",
    },
    dayInLife: {
      en: "You could meet a student feeling stressed before exams, run a university workshop and plan wellbeing activities with teachers.",
      ar: "قد تلتقي بطالب يشعر بالتوتر قبل الامتحانات، وتقدّم ورشة عن القبول الجامعي، وتخطط مع المعلمين لأنشطة تعزّز الصحة النفسية.",
    },
    weights: w(2, 5, 1, 3, 2, 5, 2, 1, 4),
    subjects: ["PSY", "ENG", "ARAB"],
    skills: {
      en: ["Listening", "Guidance", "Confidentiality", "Organisation"],
      ar: ["الإصغاء", "التوجيه والإرشاد", "الحفاظ على السرية", "التنظيم"],
    },
    education: {
      en: "A degree in psychology or education followed by a counselling qualification or master's.",
      ar: "شهادة في علم النفس أو التربية يتبعها مؤهل في الإرشاد أو درجة الماجستير.",
    },
    salaryMinAed: 12000,
    salaryMaxAed: 26000,
    outlook: "growing",
    uaeDemand: 3,
  },
  {
    key: "social_worker",
    title: { en: "Social Worker", ar: "أخصائي اجتماعي" },
    cluster: EDU,
    summary: {
      en: "Helps individuals and families through difficult times and connects them with the support and services they need.",
      ar: "يساعد الأفراد والأسر على تجاوز الظروف الصعبة، ويربطهم بخدمات الدعم التي يحتاجون إليها.",
    },
    dayInLife: {
      en: "You might visit a family at home, coordinate with a school and hospital and write a care plan for a young person.",
      ar: "قد تزور إحدى الأسر في منزلها، وتنسّق مع مدرسة ومستشفى، وتكتب خطة رعاية لأحد الشباب.",
    },
    weights: w(2, 4, 1, 2, 2, 5, 2, 1, 4),
    subjects: ["PSY", "ARAB", "ENG", "HIST"],
    skills: {
      en: ["Empathy", "Case management", "Communication", "Resilience"],
      ar: ["التعاطف", "إدارة الحالات", "التواصل", "المرونة والتحمّل"],
    },
    education: {
      en: "A degree in social work or sociology; UAE University and the University of Sharjah offer social sciences programmes.",
      ar: "شهادة في الخدمة الاجتماعية أو علم الاجتماع، وتطرح جامعة الإمارات وجامعة الشارقة برامج في العلوم الاجتماعية.",
    },
    salaryMinAed: 9000,
    salaryMaxAed: 22000,
    outlook: "stable",
    uaeDemand: 3,
  },

  // ---------------- Law and Government ----------------
  {
    key: "lawyer",
    title: { en: "Lawyer", ar: "محامٍ" },
    cluster: LAW,
    summary: {
      en: "Advises people and organisations on their rights and duties, drafts contracts and represents clients in disputes.",
      ar: "يقدّم المشورة للأفراد والمؤسسات بشأن حقوقهم وواجباتهم، ويصوغ العقود، ويمثّل موكليه في النزاعات.",
    },
    dayInLife: {
      en: "You could research case law, draft a contract, meet a client and prepare arguments for a hearing.",
      ar: "قد تبحث في السوابق القضائية، وتصوغ عقدًا، وتلتقي بموكّل، وتُعدّ المرافعة لإحدى الجلسات.",
    },
    weights: w(4, 5, 1, 4, 2, 3, 4, 1, 5),
    subjects: ["ENG", "ARAB", "HIST", "ECON"],
    skills: {
      en: ["Argument and persuasion", "Reading complex texts", "Negotiation", "Ethics"],
      ar: ["الحجة والإقناع", "قراءة النصوص المعقدة", "التفاوض", "الأخلاقيات المهنية"],
    },
    education: {
      en: "A law degree (LLB) followed by professional training; UAE University, the University of Sharjah and Sorbonne Abu Dhabi offer law.",
      ar: "بكالوريوس في القانون يتبعه تدريب مهني، وتطرح جامعة الإمارات وجامعة الشارقة وجامعة السوربون أبوظبي تخصص القانون.",
    },
    salaryMinAed: 20000,
    salaryMaxAed: 65000,
    outlook: "stable",
    uaeDemand: 3,
  },
  {
    key: "diplomat",
    title: { en: "Diplomat", ar: "دبلوماسي" },
    cluster: LAW,
    summary: {
      en: "Represents the country abroad, builds relationships between nations and supports citizens overseas.",
      ar: "يمثّل الدولة في الخارج، ويبني العلاقات بين الدول، ويقدّم الدعم للمواطنين المقيمين في الخارج.",
    },
    dayInLife: {
      en: "You might attend international meetings, draft a report on regional developments and host a cultural event at an embassy.",
      ar: "قد تحضر اجتماعات دولية، وتكتب تقريرًا عن التطورات الإقليمية، وتستضيف فعالية ثقافية في إحدى السفارات.",
    },
    weights: w(3, 5, 1, 3, 2, 4, 4, 1, 4),
    subjects: ["HIST", "ENG", "ARAB", "FR", "ECON"],
    skills: {
      en: ["Languages", "Negotiation", "Cultural awareness", "Public speaking"],
      ar: ["إتقان اللغات", "التفاوض", "الوعي الثقافي", "الخطابة"],
    },
    education: {
      en: "A degree in international relations, politics or law; the Anwar Gargash Diplomatic Academy trains future UAE diplomats.",
      ar: "شهادة في العلاقات الدولية أو العلوم السياسية أو القانون، وتتولى أكاديمية أنور قرقاش الدبلوماسية إعداد الدبلوماسيين الإماراتيين.",
    },
    salaryMinAed: 25000,
    salaryMaxAed: 60000,
    outlook: "stable",
    uaeDemand: 3,
  },
  {
    key: "urban_planner",
    title: { en: "Urban Planner", ar: "مخطط حضري" },
    cluster: LAW,
    summary: {
      en: "Designs how cities grow, deciding where homes, parks, transport and services should go to make communities liveable.",
      ar: "يرسم ملامح نمو المدن، ويحدد مواقع المساكن والحدائق ووسائل النقل والخدمات لجعل المجتمعات أكثر ملاءمة للعيش.",
    },
    dayInLife: {
      en: "You could map population data, consult residents on a new neighbourhood plan and present proposals to a municipality.",
      ar: "قد ترسم خرائط للبيانات السكانية، وتستطلع آراء السكان حول مخطط حي جديد، وتعرض المقترحات على البلدية.",
    },
    weights: w(4, 4, 5, 3, 3, 3, 3, 2, 4),
    subjects: ["GEO", "MATH", "ECON", "ART"],
    skills: {
      en: ["Mapping and GIS", "Consultation", "Policy analysis", "Design thinking"],
      ar: ["رسم الخرائط ونظم المعلومات الجغرافية", "استطلاع آراء المجتمع", "تحليل السياسات", "التفكير التصميمي"],
    },
    education: {
      en: "A degree in urban planning, geography or architecture, often with a master's in planning.",
      ar: "شهادة في التخطيط العمراني أو الجغرافيا أو العمارة، ويُستكمل ذلك غالبًا بماجستير في التخطيط.",
    },
    salaryMinAed: 16000,
    salaryMaxAed: 38000,
    outlook: "growing",
    uaeDemand: 4,
  },

  // ---------------- Aviation and Hospitality ----------------
  {
    key: "pilot",
    title: { en: "Airline Pilot", ar: "طيار مدني" },
    cluster: AVI,
    summary: {
      en: "Flies passenger or cargo aircraft safely around the world, working closely with the cabin crew and air traffic control.",
      ar: "يقود طائرات الركاب أو الشحن بأمان حول العالم، بالتنسيق الوثيق مع طاقم الضيافة والمراقبة الجوية.",
    },
    dayInLife: {
      en: "Before a flight you check the weather and the aircraft, then brief the crew, fly the route and complete post-flight reports.",
      ar: "قبل الرحلة تراجع حالة الطقس وتتفقد الطائرة، ثم تُطلع الطاقم على تفاصيل الرحلة، وتقود الطائرة، وتُكمل تقارير ما بعد الرحلة.",
    },
    weights: w(4, 3, 5, 2, 1, 3, 2, 5, 5),
    subjects: ["MATH", "PHYS", "GEO"],
    skills: {
      en: ["Spatial awareness", "Calm decision making", "Teamwork", "Following procedures"],
      ar: ["الإدراك المكاني", "اتخاذ القرار بهدوء", "العمل الجماعي", "الالتزام بالإجراءات"],
    },
    education: {
      en: "Training at an approved flight academy such as the Emirates Flight Training Academy or Etihad cadet programme, leading to a commercial licence.",
      ar: "التدريب في أكاديمية طيران معتمدة مثل أكاديمية طيران الإمارات للتدريب أو برنامج الطيارين المتدربين في الاتحاد، وصولًا إلى رخصة الطيران التجاري.",
    },
    salaryMinAed: 30000,
    salaryMaxAed: 70000,
    outlook: "growing",
    uaeDemand: 4,
  },
  {
    key: "hospitality_manager",
    title: { en: "Hospitality Manager", ar: "مدير ضيافة وفنادق" },
    cluster: AVI,
    summary: {
      en: "Runs hotels, resorts and restaurants, making sure guests have an excellent experience in one of the world's leading tourism destinations.",
      ar: "يدير الفنادق والمنتجعات والمطاعم، ويضمن تجربة مميزة للضيوف في واحدة من أبرز الوجهات السياحية في العالم.",
    },
    dayInLife: {
      en: "You may lead a morning briefing, handle a guest request, review bookings and plan staffing for a busy weekend.",
      ar: "قد تقود الاجتماع الصباحي، وتتعامل مع طلب أحد الضيوف، وتراجع الحجوزات، وتخطط لتوزيع الموظفين في عطلة نهاية أسبوع مزدحمة.",
    },
    weights: w(2, 4, 2, 1, 3, 5, 5, 2, 4),
    subjects: ["BUS", "ENG", "FR", "ARAB"],
    skills: {
      en: ["Customer service", "Leadership", "Problem solving", "Languages"],
      ar: ["خدمة العملاء", "القيادة", "حل المشكلات", "إتقان اللغات"],
    },
    education: {
      en: "A degree in hospitality or tourism management, offered at the Emirates Academy of Hospitality Management and other UAE institutions.",
      ar: "شهادة في إدارة الضيافة أو السياحة، وتُطرح في أكاديمية الإمارات لإدارة الضيافة ومؤسسات أخرى في الدولة.",
    },
    salaryMinAed: 14000,
    salaryMaxAed: 40000,
    outlook: "growing",
    uaeDemand: 4,
  },
  {
    key: "event_manager",
    title: { en: "Event Manager", ar: "مدير فعاليات" },
    cluster: AVI,
    summary: {
      en: "Plans and delivers conferences, festivals, exhibitions and sports events, handling everything from venues to guest experience.",
      ar: "يخطط للمؤتمرات والمهرجانات والمعارض والفعاليات الرياضية وينفّذها، ويتولى كل التفاصيل من اختيار المكان إلى تجربة الحضور.",
    },
    dayInLife: {
      en: "You could walk through a venue, confirm suppliers, manage the budget and coordinate a team on the day of a large exhibition.",
      ar: "قد تتفقد موقع الفعالية، وتؤكد الاتفاق مع الموردين، وتدير الميزانية، وتنسّق عمل الفريق في يوم معرض كبير.",
    },
    weights: w(2, 4, 3, 1, 4, 4, 5, 2, 5),
    subjects: ["BUS", "ENG", "ART"],
    skills: {
      en: ["Organisation", "Negotiation", "Creativity", "Working under pressure"],
      ar: ["التنظيم", "التفاوض", "الإبداع", "العمل تحت الضغط"],
    },
    education: {
      en: "A degree in event, tourism or business management; Dubai's busy events calendar offers many internships.",
      ar: "شهادة في إدارة الفعاليات أو السياحة أو الأعمال، ويوفّر تقويم الفعاليات الحافل في دبي فرص تدريب كثيرة.",
    },
    salaryMinAed: 12000,
    salaryMaxAed: 32000,
    outlook: "growing",
    uaeDemand: 4,
  },

  // ---------------- Sustainability and Energy ----------------
  {
    key: "renewable_energy_engineer",
    title: { en: "Renewable Energy Engineer", ar: "مهندس طاقة متجددة" },
    cluster: SUS,
    summary: {
      en: "Designs and improves solar, wind, hydrogen and storage systems that help the UAE reach its net zero goals.",
      ar: "يصمّم أنظمة الطاقة الشمسية وطاقة الرياح والهيدروجين وتخزين الطاقة ويطوّرها، لمساعدة الدولة على تحقيق أهداف الحياد المناخي.",
    },
    dayInLife: {
      en: "You might model the output of a solar park, inspect panels on site and work with planners on a new clean energy project.",
      ar: "قد تنمذج إنتاج مجمّع للطاقة الشمسية، وتفحص الألواح في الموقع، وتعمل مع المخططين على مشروع جديد للطاقة النظيفة.",
    },
    weights: w(5, 2, 3, 4, 3, 2, 3, 5, 3),
    subjects: ["PHYS", "MATH", "CHEM", "GEO"],
    skills: {
      en: ["Energy systems", "Data modelling", "Sustainability thinking", "Project delivery"],
      ar: ["أنظمة الطاقة", "النمذجة بالبيانات", "التفكير المستدام", "تنفيذ المشاريع"],
    },
    education: {
      en: "A degree in electrical, mechanical or energy engineering; Khalifa University leads research in clean energy, and Masdar City hosts many employers.",
      ar: "شهادة في الهندسة الكهربائية أو الميكانيكية أو هندسة الطاقة، وتتصدر جامعة خليفة أبحاث الطاقة النظيفة، وتحتضن مدينة مصدر كثيرًا من جهات التوظيف.",
    },
    salaryMinAed: 16000,
    salaryMaxAed: 38000,
    outlook: "emerging",
    uaeDemand: 5,
  },
  {
    key: "sustainability_consultant",
    title: { en: "Sustainability Consultant", ar: "مستشار استدامة" },
    cluster: SUS,
    summary: {
      en: "Helps companies and governments reduce emissions, waste and water use, and report their environmental progress.",
      ar: "يساعد الشركات والجهات الحكومية على خفض الانبعاثات والنفايات واستهلاك المياه، وإعداد تقارير عن تقدّمها البيئي.",
    },
    dayInLife: {
      en: "You could calculate a company's carbon footprint, run a workshop for staff and write a practical plan to cut energy use.",
      ar: "قد تحسب البصمة الكربونية لإحدى الشركات، وتقدّم ورشة للموظفين، وتكتب خطة عملية لخفض استهلاك الطاقة.",
    },
    weights: w(4, 4, 2, 4, 3, 4, 4, 2, 4),
    subjects: ["GEO", "ECON", "BIO", "CHEM"],
    skills: {
      en: ["Carbon accounting", "Persuasion", "Research", "Report writing"],
      ar: ["حساب البصمة الكربونية", "الإقناع", "البحث", "كتابة التقارير"],
    },
    education: {
      en: "A degree in environmental science, engineering or business, with growing sustainability programmes across UAE universities.",
      ar: "شهادة في علوم البيئة أو الهندسة أو إدارة الأعمال، مع تزايد برامج الاستدامة في الجامعات الإماراتية.",
    },
    salaryMinAed: 15000,
    salaryMaxAed: 38000,
    outlook: "emerging",
    uaeDemand: 5,
  },

  // ---------------- Sports ----------------
  {
    key: "sports_scientist",
    title: { en: "Sports Scientist", ar: "أخصائي علوم رياضية" },
    cluster: SPORT,
    summary: {
      en: "Uses physiology, biomechanics and data to improve athletes' performance and reduce injuries.",
      ar: "يستعين بعلم وظائف الأعضاء والميكانيكا الحيوية والبيانات لتحسين أداء الرياضيين والحد من إصاباتهم.",
    },
    dayInLife: {
      en: "You might test an athlete's fitness, analyse GPS data from training and plan recovery sessions with the coaching team.",
      ar: "قد تختبر لياقة أحد الرياضيين، وتحلّل بيانات تحديد المواقع من التدريب، وتخطط لجلسات الاستشفاء مع الجهاز الفني.",
    },
    weights: w(4, 2, 2, 4, 2, 4, 2, 4, 3),
    subjects: ["PE", "BIO", "MATH"],
    skills: {
      en: ["Exercise physiology", "Data analysis", "Coaching communication", "Motivation"],
      ar: ["فسيولوجيا التمرين", "تحليل البيانات", "التواصل مع المدربين", "التحفيز"],
    },
    education: {
      en: "A degree in sports and exercise science; UAE University and several UK branch campuses in the UAE offer related programmes.",
      ar: "شهادة في علوم الرياضة والتمرين، وتطرح جامعة الإمارات وعدد من فروع الجامعات البريطانية في الدولة برامج ذات صلة.",
    },
    salaryMinAed: 11000,
    salaryMaxAed: 26000,
    outlook: "growing",
    uaeDemand: 3,
  },
  {
    key: "sports_coach",
    title: { en: "Sports Coach", ar: "مدرب رياضي" },
    cluster: SPORT,
    summary: {
      en: "Trains athletes and teams, building their skills, fitness, confidence and teamwork.",
      ar: "يدرّب الرياضيين والفرق، ويطوّر مهاراتهم ولياقتهم وثقتهم بأنفسهم وروح العمل الجماعي لديهم.",
    },
    dayInLife: {
      en: "You could plan a training session, run drills with a youth academy, review match footage and talk with players about their goals.",
      ar: "قد تخطط لحصة تدريبية، وتنفّذ تمارين مع إحدى أكاديميات الناشئين، وتراجع تسجيلات المباريات، وتناقش اللاعبين في أهدافهم.",
    },
    weights: w(2, 4, 3, 2, 3, 5, 4, 4, 3),
    subjects: ["PE", "BIO", "PSY"],
    skills: {
      en: ["Leadership", "Motivation", "Tactical thinking", "Communication"],
      ar: ["القيادة", "التحفيز", "التفكير التكتيكي", "التواصل"],
    },
    education: {
      en: "Coaching certificates from national federations, often combined with a degree in sports science or physical education.",
      ar: "شهادات تدريب من الاتحادات الرياضية الوطنية، وغالبًا ما تُقرن بشهادة في علوم الرياضة أو التربية البدنية.",
    },
    salaryMinAed: 9000,
    salaryMaxAed: 25000,
    outlook: "stable",
    uaeDemand: 3,
  },
];
