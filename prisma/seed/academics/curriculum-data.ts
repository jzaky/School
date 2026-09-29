// Demo curriculum frameworks. Outcomes are written generically in the style of the UK National Curriculum
// and UAE Ministry of Education outcomes; they are not copied from any published document.

export type SeedStandard = { code: string; strand: [string, string]; desc: [string, string] };
export type SeedFramework = { key: string; subjectCode: string; grade: number; name: [string, string]; source: string; standards: SeedStandard[] };

const S = (code: string, strand: [string, string], en: string, ar: string): SeedStandard => ({ code, strand, desc: [en, ar] });

const AL: [string, string] = ["Algorithms", "الخوارزميات"];
const PR: [string, string] = ["Programming", "البرمجة"];
const DR: [string, string] = ["Data representation", "تمثيل البيانات"];
const SN: [string, string] = ["Computer systems and networks", "أنظمة الحاسوب والشبكات"];
const DC: [string, string] = ["Digital citizenship and safety", "المواطنة الرقمية والسلامة"];

const COMPUTING_9: SeedStandard[] = [
  S("CS9.AL.1", AL, "Decompose a problem into smaller sub-problems and describe the steps to solve each.", "تجزئة المشكلة إلى مشكلات فرعية أصغر ووصف خطوات حل كل منها."),
  S("CS9.AL.2", AL, "Represent algorithms using flowcharts and pseudocode.", "تمثيل الخوارزميات باستخدام المخططات الانسيابية والشيفرة الزائفة."),
  S("CS9.AL.3", AL, "Trace an algorithm with a trace table to predict its output.", "تتبع الخوارزمية باستخدام جدول التتبع للتنبؤ بمخرجاتها."),
  S("CS9.AL.4", AL, "Compare linear and binary search and explain when each is appropriate.", "المقارنة بين البحث الخطي والبحث الثنائي وتوضيح متى يناسب كل منهما."),
  S("CS9.AL.5", AL, "Describe how bubble sort and merge sort put a list in order.", "وصف كيفية ترتيب القائمة باستخدام الفرز الفقاعي والفرز بالدمج."),
  S("CS9.PR.1", PR, "Write programs that use sequence, selection and iteration.", "كتابة برامج تستخدم التسلسل والاختيار والتكرار."),
  S("CS9.PR.2", PR, "Use variables, data types and operators correctly in a text-based language.", "استخدام المتغيرات وأنواع البيانات والعوامل بشكل صحيح في لغة برمجة نصية."),
  S("CS9.PR.3", PR, "Use lists or arrays to store and process collections of data.", "استخدام القوائم أو المصفوفات لتخزين مجموعات البيانات ومعالجتها."),
  S("CS9.PR.4", PR, "Create subroutines with parameters and return values to structure a program.", "إنشاء برامج فرعية ذات معاملات وقيم مُعادة لتنظيم البرنامج."),
  S("CS9.PR.5", PR, "Validate user input and handle errors so that programs are robust.", "التحقق من صحة مدخلات المستخدم ومعالجة الأخطاء لجعل البرامج موثوقة."),
  S("CS9.PR.6", PR, "Test programs with normal, boundary and erroneous data and fix logic errors.", "اختبار البرامج ببيانات عادية وحدّية وخاطئة وتصحيح الأخطاء المنطقية."),
  S("CS9.DR.1", DR, "Convert between binary, denary and hexadecimal numbers.", "التحويل بين الأعداد الثنائية والعشرية والست عشرية."),
  S("CS9.DR.2", DR, "Explain how characters are represented using ASCII and Unicode, including Arabic script.", "شرح كيفية تمثيل الأحرف باستخدام ASCII ويونيكود بما في ذلك الحروف العربية."),
  S("CS9.DR.3", DR, "Explain how images and sound are stored in binary and calculate file sizes.", "شرح كيفية تخزين الصور والأصوات بالنظام الثنائي وحساب أحجام الملفات."),
  S("CS9.DR.4", DR, "Describe lossy and lossless compression and when each is used.", "وصف الضغط مع فقدان البيانات ودون فقدانها ومتى يُستخدم كل منهما."),
  S("CS9.SN.1", SN, "Describe the role of the CPU, memory and storage in the fetch-execute cycle.", "وصف دور وحدة المعالجة المركزية والذاكرة ووحدات التخزين في دورة الجلب والتنفيذ."),
  S("CS9.SN.2", SN, "Explain how data travels across networks using packets, protocols and IP addresses.", "شرح كيفية انتقال البيانات عبر الشبكات باستخدام الحزم والبروتوكولات وعناوين IP."),
  S("CS9.SN.3", SN, "Compare wired and wireless networks and common network topologies.", "المقارنة بين الشبكات السلكية واللاسلكية وأشكال الشبكات الشائعة."),
  S("CS9.DC.1", DC, "Identify common cyber threats such as phishing and malware and ways to prevent them.", "التعرف على التهديدات الإلكترونية الشائعة مثل التصيد الاحتيالي والبرمجيات الخبيثة وطرق الوقاية منها."),
  S("CS9.DC.2", DC, "Explain responsible use of personal data in line with UAE data protection principles.", "شرح الاستخدام المسؤول للبيانات الشخصية وفق مبادئ حماية البيانات في دولة الإمارات."),
  S("CS9.DC.3", DC, "Discuss the ethical, legal and environmental impacts of computing, including artificial intelligence.", "مناقشة الآثار الأخلاقية والقانونية والبيئية للحوسبة بما فيها الذكاء الاصطناعي."),
];

const N: [string, string] = ["Number", "الأعداد"];
const A: [string, string] = ["Algebra", "الجبر"];
const R: [string, string] = ["Ratio and proportion", "النسبة والتناسب"];
const G: [string, string] = ["Geometry and measures", "الهندسة والقياس"];
const P: [string, string] = ["Probability and statistics", "الاحتمالات والإحصاء"];

const MATHS_9: SeedStandard[] = [
  S("MA9.N.1", N, "Use the laws of indices with positive, negative and zero powers.", "استخدام قوانين الأسس مع القوى الموجبة والسالبة والصفرية."),
  S("MA9.N.2", N, "Write and calculate with numbers in standard form.", "كتابة الأعداد بالصيغة العلمية وإجراء العمليات الحسابية عليها."),
  S("MA9.N.3", N, "Simplify surds and rationalise simple denominators.", "تبسيط الجذور وإنطاق المقامات البسيطة."),
  S("MA9.N.4", N, "Use upper and lower bounds to state the accuracy of a measurement.", "استخدام الحدود العليا والدنيا لبيان دقة القياس."),
  S("MA9.A.1", A, "Expand and factorise quadratic expressions.", "فك المقادير التربيعية وتحليلها إلى عوامل."),
  S("MA9.A.2", A, "Solve linear equations and inequalities, including those with unknowns on both sides.", "حل المعادلات والمتباينات الخطية بما فيها التي تحتوي على المجهول في الطرفين."),
  S("MA9.A.3", A, "Solve pairs of simultaneous linear equations algebraically and graphically.", "حل أنظمة المعادلات الخطية جبريًا وبيانيًا."),
  S("MA9.A.4", A, "Find the gradient and intercept of a straight line and use y = mx + c.", "إيجاد الميل والمقطع للخط المستقيم واستخدام المعادلة y = mx + c."),
  S("MA9.A.5", A, "Recognise and sketch graphs of quadratic, cubic and reciprocal functions.", "التعرف على منحنيات الدوال التربيعية والتكعيبية والمقلوبة ورسمها."),
  S("MA9.A.6", A, "Generate terms of arithmetic and geometric sequences and find the nth term.", "توليد حدود المتتاليات الحسابية والهندسية وإيجاد الحد النوني."),
  S("MA9.R.1", R, "Solve problems involving direct and inverse proportion.", "حل مسائل التناسب الطردي والعكسي."),
  S("MA9.R.2", R, "Calculate percentage change, compound interest and depreciation.", "حساب نسبة التغير المئوية والفائدة المركبة والاستهلاك."),
  S("MA9.R.3", R, "Use compound measures such as speed, density and pressure.", "استخدام المقاييس المركبة مثل السرعة والكثافة والضغط."),
  S("MA9.G.1", G, "Apply Pythagoras' theorem in two dimensions.", "تطبيق نظرية فيثاغورس في بعدين."),
  S("MA9.G.2", G, "Use sine, cosine and tangent ratios in right-angled triangles.", "استخدام نسب الجيب وجيب التمام والظل في المثلثات القائمة."),
  S("MA9.G.3", G, "Calculate arc length, sector area and the surface area and volume of prisms and cylinders.", "حساب طول القوس ومساحة القطاع والمساحة السطحية وحجم المنشورات والأسطوانات."),
  S("MA9.G.4", G, "Describe and carry out translations, rotations, reflections and enlargements.", "وصف التحويلات الهندسية وتنفيذها: الانسحاب والدوران والانعكاس والتكبير."),
  S("MA9.S.1", P, "Calculate probabilities of combined events using tree and Venn diagrams.", "حساب احتمالات الأحداث المركبة باستخدام المخططات الشجرية وأشكال فن."),
  S("MA9.S.2", P, "Draw and interpret scatter graphs, including correlation and lines of best fit.", "رسم مخططات الانتشار وتفسيرها بما في ذلك الارتباط وخط أفضل مطابقة."),
  S("MA9.S.3", P, "Compare distributions using averages, range and box plots.", "مقارنة التوزيعات باستخدام المتوسطات والمدى والمخططات الصندوقية."),
];

const FM: [string, string] = ["Forces and motion", "القوى والحركة"];
const EN: [string, string] = ["Energy", "الطاقة"];
const EL: [string, string] = ["Electricity", "الكهرباء"];
const WV: [string, string] = ["Waves", "الموجات"];
const WS: [string, string] = ["Working scientifically", "العمل العلمي"];

const SCIENCE_10: SeedStandard[] = [
  S("SC10.FM.1", FM, "Distinguish between scalar and vector quantities and resolve forces.", "التمييز بين الكميات القياسية والمتجهة وتحليل القوى."),
  S("SC10.FM.2", FM, "Interpret distance-time and velocity-time graphs and calculate acceleration.", "تفسير منحنيات المسافة والزمن والسرعة والزمن وحساب التسارع."),
  S("SC10.FM.3", FM, "Apply Newton's three laws of motion to everyday situations.", "تطبيق قوانين نيوتن الثلاثة للحركة على مواقف حياتية."),
  S("SC10.FM.4", FM, "Calculate momentum and apply conservation of momentum in collisions.", "حساب الزخم وتطبيق مبدأ حفظ الزخم في التصادمات."),
  S("SC10.FM.5", FM, "Explain stopping distances and the factors that affect road safety.", "شرح مسافات التوقف والعوامل المؤثرة في السلامة على الطرق."),
  S("SC10.EN.1", EN, "Calculate kinetic and gravitational potential energy and describe energy transfers.", "حساب طاقة الحركة وطاقة الوضع الجاذبية ووصف تحولات الطاقة."),
  S("SC10.EN.2", EN, "Calculate efficiency and power for real devices.", "حساب الكفاءة والقدرة لأجهزة حقيقية."),
  S("SC10.EN.3", EN, "Evaluate renewable and non-renewable energy resources, including solar energy in the UAE.", "تقييم مصادر الطاقة المتجددة وغير المتجددة بما فيها الطاقة الشمسية في دولة الإمارات."),
  S("SC10.EL.1", EL, "Use the relationship between current, potential difference and resistance.", "استخدام العلاقة بين شدة التيار وفرق الجهد والمقاومة."),
  S("SC10.EL.2", EL, "Compare series and parallel circuits.", "المقارنة بين دوائر التوالي ودوائر التوازي."),
  S("SC10.EL.3", EL, "Explain the domestic electricity supply and electrical safety.", "شرح إمدادات الكهرباء المنزلية وقواعد السلامة الكهربائية."),
  S("SC10.WV.1", WV, "Describe transverse and longitudinal waves and use the wave equation.", "وصف الموجات المستعرضة والطولية واستخدام معادلة الموجة."),
  S("SC10.WV.2", WV, "Describe the properties and uses of the electromagnetic spectrum.", "وصف خصائص الطيف الكهرومغناطيسي واستخداماته."),
  S("SC10.WV.3", WV, "Explain reflection and refraction using ray diagrams.", "شرح الانعكاس والانكسار باستخدام مخططات الأشعة."),
  S("SC10.WS.1", WS, "Plan a fair test, identifying independent, dependent and control variables.", "تخطيط اختبار عادل مع تحديد المتغيرات المستقلة والتابعة والمضبوطة."),
  S("SC10.WS.2", WS, "Record data accurately and evaluate uncertainty and sources of error.", "تسجيل البيانات بدقة وتقييم عدم اليقين ومصادر الخطأ."),
  S("SC10.WS.3", WS, "Carry out practical work safely, following a risk assessment.", "تنفيذ العمل العملي بأمان وفق تقييم المخاطر."),
];

export const FRAMEWORKS: SeedFramework[] = [
  { key: "cs-g9", subjectCode: "CS", grade: 9, name: ["Grade 9 Computing", "الحوسبة للصف التاسع"], source: "School scheme based on UK National Curriculum Key Stage 4 and UAE MoE Computing outcomes", standards: COMPUTING_9 },
  { key: "math-g9", subjectCode: "MATH", grade: 9, name: ["Grade 9 Mathematics", "الرياضيات للصف التاسع"], source: "School scheme based on UK National Curriculum and UAE MoE Mathematics outcomes", standards: MATHS_9 },
  { key: "sci-g10", subjectCode: "PHYS", grade: 10, name: ["Grade 10 Science: Physics", "العلوم للصف العاشر: الفيزياء"], source: "School scheme based on UK National Curriculum and UAE MoE Science outcomes", standards: SCIENCE_10 },
];

export type SeedPlan = {
  key: string;
  codes: string[];
  title: [string, string];
  status: "APPROVED" | "SUBMITTED" | "CHANGES_REQUESTED" | "DRAFT";
  comment?: string;
};

/** Daniel Carter's Grade 9 Computing term. Several standards are deliberately left uncovered. */
export const COMPUTING_PLANS: SeedPlan[] = [
  { key: "cs1", codes: ["CS9.AL.1"], title: ["Decomposition: breaking down big problems", "التجزئة: تقسيم المشكلات الكبيرة"], status: "APPROVED", comment: "Clear objectives and a strong hook." },
  { key: "cs2", codes: ["CS9.AL.2", "CS9.AL.1"], title: ["Flowcharts and pseudocode", "المخططات الانسيابية والشيفرة الزائفة"], status: "APPROVED" },
  { key: "cs3", codes: ["CS9.AL.3"], title: ["Tracing algorithms with trace tables", "تتبع الخوارزميات بجداول التتبع"], status: "APPROVED" },
  { key: "cs4", codes: ["CS9.PR.2"], title: ["Variables, data types and operators", "المتغيرات وأنواع البيانات والعوامل"], status: "APPROVED" },
  { key: "cs5", codes: ["CS9.PR.1"], title: ["Making decisions with selection", "اتخاذ القرارات باستخدام الاختيار"], status: "APPROVED", comment: "Good use of pair programming." },
  { key: "cs6", codes: ["CS9.PR.1", "CS9.AL.3"], title: ["Loops: count and condition controlled", "الحلقات: المحددة بعدد والمشروطة"], status: "APPROVED" },
  { key: "cs7", codes: ["CS9.PR.3"], title: ["Storing data in lists", "تخزين البيانات في القوائم"], status: "APPROVED" },
  { key: "cs8", codes: ["CS9.DR.1"], title: ["Binary and denary numbers", "الأعداد الثنائية والعشرية"], status: "APPROVED" },
  { key: "cs9", codes: ["CS9.DR.1"], title: ["Hexadecimal and why we use it", "النظام الست عشري وسبب استخدامه"], status: "APPROVED" },
  {
    key: "cs10",
    codes: ["CS9.DR.2"],
    title: ["Characters, ASCII and Unicode", "الأحرف وASCII ويونيكود"],
    status: "CHANGES_REQUESTED",
    comment: "Please add a practical task where students encode Arabic letters in Unicode, and make the exit ticket check both ASCII and Unicode.",
  },
  { key: "cs11", codes: ["CS9.PR.4"], title: ["Subroutines with parameters", "البرامج الفرعية ذات المعاملات"], status: "SUBMITTED" },
  { key: "cs12", codes: ["CS9.AL.4"], title: ["Searching: linear and binary search", "البحث: الخطي والثنائي"], status: "SUBMITTED" },
  { key: "cs13", codes: ["CS9.PR.5"], title: ["Validation and robust programs", "التحقق من المدخلات والبرامج الموثوقة"], status: "DRAFT" },
  { key: "cs14", codes: ["CS9.PR.6"], title: ["Testing with normal, boundary and erroneous data", "الاختبار ببيانات عادية وحدّية وخاطئة"], status: "DRAFT" },
  { key: "cs15", codes: ["CS9.DR.3"], title: ["Images and sound in binary", "الصور والأصوات بالنظام الثنائي"], status: "DRAFT" },
];

/** Standards the demo AI-drafted unit covers (built with the same drafter the app uses without a model). */
export const AI_UNIT_CODES = ["CS9.DC.1", "CS9.DC.2"];

export const MATHS_PLANS: SeedPlan[] = [
  { key: "ma1", codes: ["MA9.N.1"], title: ["Laws of indices", "قوانين الأسس"], status: "APPROVED" },
  { key: "ma2", codes: ["MA9.N.2", "MA9.N.1"], title: ["Standard form", "الصيغة العلمية"], status: "APPROVED" },
  { key: "ma3", codes: ["MA9.A.1"], title: ["Expanding double brackets", "فك الأقواس المزدوجة"], status: "APPROVED" },
  { key: "ma4", codes: ["MA9.A.1"], title: ["Factorising quadratics", "تحليل المقادير التربيعية"], status: "APPROVED" },
  { key: "ma5", codes: ["MA9.A.2"], title: ["Equations with unknowns on both sides", "معادلات بمجهول في الطرفين"], status: "APPROVED" },
  { key: "ma6", codes: ["MA9.R.1", "MA9.R.2"], title: ["Proportion and percentage change", "التناسب ونسبة التغير المئوية"], status: "SUBMITTED" },
];

export const SCIENCE_PLANS: SeedPlan[] = [
  { key: "sc1", codes: ["SC10.FM.1"], title: ["Scalars, vectors and resultant forces", "الكميات القياسية والمتجهة والقوة المحصلة"], status: "APPROVED" },
  { key: "sc2", codes: ["SC10.FM.2", "SC10.WS.2"], title: ["Motion graphs from a trolley practical", "منحنيات الحركة من تجربة العربة"], status: "APPROVED" },
  { key: "sc3", codes: ["SC10.FM.3", "SC10.WS.3"], title: ["Newton's laws in action", "قوانين نيوتن في الواقع"], status: "APPROVED" },
  { key: "sc4", codes: ["SC10.WS.1"], title: ["Planning a fair test", "تخطيط اختبار عادل"], status: "APPROVED" },
  { key: "sc5", codes: ["SC10.EN.1"], title: ["Energy stores and transfers", "مخازن الطاقة وتحولاتها"], status: "DRAFT" },
];
