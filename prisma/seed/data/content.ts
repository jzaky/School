// Fictional school content for Horizon International School Dubai.
import type { Bi } from "./people";

const b = (en: string, ar: string): Bi => ({ en, ar });

export const ANNOUNCEMENTS: Array<{ title: Bi; body: Bi; audience: string[]; daysAgo: number }> = [
  {
    title: b("Welcome back to Term 1", "أهلاً بعودتكم في الفصل الدراسي الأول"),
    body: b(
      "We are delighted to welcome our students, families and staff back to Horizon. A special welcome to the families joining our community this year. Please check the calendar for key dates this term.",
      "يسعدنا أن نرحب بعودة طلابنا وأسرهم وكادرنا إلى مدرسة هورايزن، مع ترحيب خاص بالأسر التي تنضم إلى مجتمعنا هذا العام. يرجى الاطلاع على التقويم لمعرفة أهم مواعيد هذا الفصل.",
    ),
    audience: ["all"],
    daysAgo: 35,
  },
  {
    title: b("Updated drop-off and pick-up arrangements", "تحديث ترتيبات توصيل الطلاب واستلامهم"),
    body: b(
      "From Monday, secondary drop-off will take place at Gate 3 between 7:15 and 7:40. Please do not stop in the bus lane, and remain in your vehicle while students exit safely.",
      "اعتباراً من يوم الاثنين، سيكون توصيل طلاب المرحلة الثانوية عبر البوابة رقم 3 بين الساعة 7:15 و7:40 صباحاً. نرجو عدم التوقف في مسار الحافلات، والبقاء داخل السيارة إلى أن ينزل الطلاب بأمان.",
    ),
    audience: ["parent", "student"],
    daysAgo: 30,
  },
  {
    title: b("Emirati Women's Day celebration", "الاحتفال بيوم المرأة الإماراتية"),
    body: b(
      "Thank you to everyone who joined our assembly celebrating Emirati Women's Day. Our Grade 10 students led a moving tribute to women who have shaped the UAE.",
      "نشكر كل من شاركنا في الطابور الصباحي احتفاءً بيوم المرأة الإماراتية، حيث قدّم طلاب الصف العاشر تحية مؤثرة لنساء أسهمن في بناء دولة الإمارات.",
    ),
    audience: ["all"],
    daysAgo: 31,
  },
  {
    title: b("Co-curricular activities registration now open", "فتح باب التسجيل في الأنشطة اللاصفية"),
    body: b(
      "Students can now register for this term's co-curricular activities through the student portal. Places in popular clubs such as robotics, debate and swimming are limited, so please register by Thursday.",
      "أصبح بإمكان الطلاب الآن التسجيل في الأنشطة اللاصفية لهذا الفصل عبر بوابة الطالب. المقاعد محدودة في الأندية الأكثر إقبالاً مثل الروبوتات والمناظرة والسباحة، لذا نرجو إتمام التسجيل قبل يوم الخميس.",
    ),
    audience: ["student", "parent"],
    daysAgo: 24,
  },
  {
    title: b("Staff briefing moved to Tuesday", "نقل الاجتماع التنويري للموظفين إلى يوم الثلاثاء"),
    body: b(
      "This week's staff briefing will take place on Tuesday at 7:10 in the auditorium. We will cover the updated attendance procedures and the parent-teacher conference schedule.",
      "يُعقد الاجتماع التنويري للموظفين هذا الأسبوع يوم الثلاثاء الساعة 7:10 صباحاً في المسرح، وسنتناول فيه إجراءات الحضور المحدّثة وجدول لقاءات أولياء الأمور والمعلمين.",
    ),
    audience: ["staff"],
    daysAgo: 16,
  },
  {
    title: b("Grade 12 university applications support", "دعم طلبات الالتحاق بالجامعات لطلاب الصف الثاني عشر"),
    body: b(
      "Our university guidance team is holding daily drop-in sessions in the Careers Hub during lunch. Students applying through UCAS or to US universities should book a personal statement review before the October deadlines.",
      "يقدّم فريق الإرشاد الجامعي جلسات يومية مفتوحة في مركز الإرشاد المهني خلال استراحة الغداء. وعلى الطلاب المتقدمين عبر نظام UCAS أو إلى الجامعات الأمريكية حجز موعد لمراجعة البيان الشخصي قبل مواعيد أكتوبر النهائية.",
    ),
    audience: ["student", "parent"],
    daysAgo: 12,
  },
  {
    title: b("Hot weather guidance", "إرشادات الطقس الحار"),
    body: b(
      "Outdoor PE lessons will continue to be scheduled before 9:00 while temperatures remain high. Please make sure your child brings a labelled, refillable water bottle every day.",
      "ستستمر حصص التربية البدنية الخارجية قبل الساعة التاسعة صباحاً ما دامت درجات الحرارة مرتفعة. نرجو التأكد من إحضار أبنائكم زجاجة ماء قابلة لإعادة التعبئة تحمل أسماءهم يومياً.",
    ),
    audience: ["parent", "student"],
    daysAgo: 9,
  },
  {
    title: b("Parent-teacher conferences: booking open", "لقاءات أولياء الأمور والمعلمين: فتح باب الحجز"),
    body: b(
      "Bookings for the Term 1 parent-teacher conferences are now open in the parent portal. Appointments are ten minutes long and can be held in person or online.",
      "أصبح حجز مواعيد لقاءات أولياء الأمور والمعلمين للفصل الأول متاحاً عبر بوابة أولياء الأمور. مدة كل لقاء عشر دقائق، ويمكن حضوره في المدرسة أو عبر الإنترنت.",
    ),
    audience: ["parent"],
    daysAgo: 6,
  },
  {
    title: b("Wellbeing week: small habits, big difference", "أسبوع الرفاه: عادات صغيرة وأثر كبير"),
    body: b(
      "Next week is Wellbeing Week. Tutor groups will explore sleep, screen time and healthy study routines, and the counselling team will host an open session for parents on supporting teenagers during exam season.",
      "يصادف الأسبوع المقبل أسبوع الرفاه، حيث ستتناول مجموعات الإرشاد الصفي موضوعات النوم ووقت الشاشات وعادات المذاكرة الصحية، كما سيعقد فريق الإرشاد جلسة مفتوحة لأولياء الأمور حول دعم المراهقين خلال فترة الامتحانات.",
    ),
    audience: ["all"],
    daysAgo: 3,
  },
  {
    title: b("Lost property collection", "استلام المفقودات"),
    body: b(
      "Unclaimed items in lost property will be donated to charity at the end of next week. Please encourage your child to check the tables outside the main reception.",
      "سيتم التبرع بالمفقودات التي لا يُطالب بها لجهات خيرية في نهاية الأسبوع المقبل. نرجو تشجيع أبنائكم على مراجعة الطاولات المخصصة لها خارج مكتب الاستقبال الرئيسي.",
    ),
    audience: ["parent", "student"],
    daysAgo: 1,
  },
];

export const CALENDAR_EVENTS: Array<{
  kind: "EVENT" | "DEADLINE" | "HOLIDAY" | "EXAM";
  title: Bi;
  description?: Bi;
  dayOffset: number;
  durationDays?: number;
  startHour?: number;
  durationHours?: number;
  audience: string[];
}> = [
  {
    kind: "DEADLINE",
    title: b("Re-enrolment confirmation deadline", "الموعد النهائي لتأكيد إعادة التسجيل"),
    description: b(
      "Families should confirm places for the new academic year through the parent portal.",
      "يُرجى من الأسر تأكيد مقاعد أبنائها للعام الدراسي الجديد عبر بوابة أولياء الأمور.",
    ),
    dayOffset: -56,
    audience: ["parent"],
  },
  {
    kind: "EVENT",
    title: b("Staff induction and training days", "أيام التهيئة والتدريب للموظفين"),
    dayOffset: -42,
    durationDays: 5,
    startHour: 8,
    durationHours: 7,
    audience: ["staff"],
  },
  {
    kind: "EVENT",
    title: b("First day of Term 1", "اليوم الأول من الفصل الدراسي الأول"),
    description: b("Students return for the new academic year.", "عودة الطلاب لبدء العام الدراسي الجديد."),
    dayOffset: -35,
    startHour: 7,
    durationHours: 7,
    audience: ["all"],
  },
  {
    kind: "HOLIDAY",
    title: b("Prophet's Birthday (school closed)", "ذكرى المولد النبوي الشريف (عطلة رسمية)"),
    dayOffset: -34,
    audience: ["all"],
  },
  {
    kind: "EVENT",
    title: b("New parents' coffee morning", "لقاء صباحي لأولياء الأمور الجدد"),
    description: b(
      "An informal welcome with the leadership team and the Parents' Association.",
      "لقاء ترحيبي غير رسمي مع فريق القيادة وجمعية أولياء الأمور.",
    ),
    dayOffset: -32,
    startHour: 8,
    durationHours: 2,
    audience: ["parent"],
  },
  {
    kind: "EVENT",
    title: b("Emirati Women's Day assembly", "طابور احتفالي بيوم المرأة الإماراتية"),
    dayOffset: -31,
    startHour: 8,
    durationHours: 1,
    audience: ["all"],
  },
  {
    kind: "EVENT",
    title: b("Grade 12 university information evening", "أمسية تعريفية بالجامعات لطلاب الصف الثاني عشر"),
    description: b(
      "An overview of UCAS, US and regional university applications for students and parents.",
      "عرض شامل لإجراءات التقديم عبر UCAS وإلى الجامعات الأمريكية والإقليمية للطلاب وأولياء الأمور.",
    ),
    dayOffset: -20,
    startHour: 18,
    durationHours: 2,
    audience: ["student", "parent"],
  },
  {
    kind: "EVENT",
    title: b("Student council elections", "انتخابات مجلس الطلبة"),
    dayOffset: -14,
    startHour: 9,
    durationHours: 3,
    audience: ["student", "staff"],
  },
  {
    kind: "EXAM",
    title: b("CAT4 assessments for Grades 7 and 9", "اختبارات CAT4 للصفين السابع والتاسع"),
    dayOffset: -11,
    startHour: 8,
    durationHours: 3,
    audience: ["student", "parent", "staff"],
  },
  {
    kind: "EVENT",
    title: b("Parent workshop: supporting teenagers with exam stress", "ورشة لأولياء الأمور: دعم المراهقين في مواجهة ضغط الامتحانات"),
    description: b(
      "Led by the counselling and wellbeing team in the library.",
      "يقدّمها فريق الإرشاد والرفاه في مكتبة المدرسة.",
    ),
    dayOffset: 3,
    startHour: 8,
    durationHours: 2,
    audience: ["parent"],
  },
  {
    kind: "EVENT",
    title: b("Parent-teacher conferences", "لقاءات أولياء الأمور والمعلمين"),
    description: b(
      "Ten-minute appointments, in person or online. Students finish at 12:30 on both days.",
      "لقاءات مدتها عشر دقائق حضورياً أو عبر الإنترنت، وينتهي دوام الطلاب الساعة 12:30 ظهراً في اليومين.",
    ),
    dayOffset: 9,
    durationDays: 2,
    startHour: 13,
    durationHours: 5,
    audience: ["parent", "staff"],
  },
  {
    kind: "HOLIDAY",
    title: b("Mid-term break", "عطلة منتصف الفصل"),
    dayOffset: 14,
    durationDays: 5,
    audience: ["all"],
  },
  {
    kind: "DEADLINE",
    title: b("UCAS early deadline (Oxford, Cambridge, Medicine)", "الموعد المبكر لطلبات UCAS (أكسفورد وكامبريدج والطب)"),
    description: b(
      "Final references must be attached by the university guidance team before this date.",
      "يجب أن يُرفق فريق الإرشاد الجامعي التوصيات النهائية قبل هذا الموعد.",
    ),
    dayOffset: 17,
    audience: ["student", "parent", "staff"],
  },
  {
    kind: "EVENT",
    title: b("Secondary Science Fair", "معرض العلوم للمرحلة الثانوية"),
    description: b(
      "Grades 7 to 10 present their investigations in the sports hall. Parents are warmly invited from 12:00.",
      "يعرض طلاب الصفوف من السابع إلى العاشر مشاريعهم البحثية في الصالة الرياضية، ويسعدنا حضور أولياء الأمور ابتداءً من الساعة 12:00 ظهراً.",
    ),
    dayOffset: 23,
    startHour: 9,
    durationHours: 5,
    audience: ["all"],
  },
  {
    kind: "EVENT",
    title: b("Admissions open day", "اليوم المفتوح للقبول والتسجيل"),
    description: b(
      "Prospective families tour the campus with student ambassadors.",
      "جولات في الحرم المدرسي للأسر الراغبة في التسجيل برفقة سفراء الطلبة.",
    ),
    dayOffset: 31,
    startHour: 9,
    durationHours: 3,
    audience: ["staff", "parent"],
  },
  {
    kind: "DEADLINE",
    title: b("US Early Action and Early Decision deadline", "الموعد النهائي للقبول المبكر في الجامعات الأمريكية"),
    dayOffset: 34,
    audience: ["student", "parent", "staff"],
  },
  {
    kind: "EVENT",
    title: b("Grade 9 options evening", "أمسية اختيار المواد لطلاب الصف التاسع"),
    description: b(
      "Heads of department introduce IGCSE subject choices for next year.",
      "يعرّف رؤساء الأقسام بمواد شهادة IGCSE المتاحة للاختيار في العام المقبل.",
    ),
    dayOffset: 38,
    startHour: 18,
    durationHours: 2,
    audience: ["student", "parent"],
  },
  {
    kind: "EVENT",
    title: b("Secondary Sports Day", "اليوم الرياضي للمرحلة الثانوية"),
    dayOffset: 43,
    startHour: 7,
    durationHours: 5,
    audience: ["all"],
  },
  {
    kind: "EXAM",
    title: b("Mock examinations for Grades 11 and 12", "الامتحانات التجريبية للصفين الحادي عشر والثاني عشر"),
    dayOffset: 56,
    durationDays: 10,
    audience: ["student", "parent", "staff"],
  },
  {
    kind: "EVENT",
    title: b("UAE National Day celebrations", "احتفالات اليوم الوطني لدولة الإمارات"),
    description: b(
      "Traditional dress, heritage activities and a whole-school assembly.",
      "أزياء تراثية وأنشطة تعكس الموروث الإماراتي وطابور احتفالي لجميع المراحل.",
    ),
    dayOffset: 60,
    startHour: 8,
    durationHours: 4,
    audience: ["all"],
  },
  {
    kind: "HOLIDAY",
    title: b("Commemoration Day", "يوم الشهيد"),
    dayOffset: 63,
    audience: ["all"],
  },
  {
    kind: "HOLIDAY",
    title: b("UAE National Day holiday", "عطلة اليوم الوطني"),
    dayOffset: 64,
    durationDays: 3,
    audience: ["all"],
  },
  {
    kind: "EVENT",
    title: b("Arabic Language Day celebration", "الاحتفال باليوم العالمي للغة العربية"),
    description: b(
      "Poetry recitals, calligraphy workshops and a reading challenge ahead of 18 December.",
      "إلقاء شعري وورش للخط العربي وتحدي القراءة احتفاءً باليوم العالمي للغة العربية في 18 ديسمبر.",
    ),
    dayOffset: 73,
    startHour: 8,
    durationHours: 4,
    audience: ["all"],
  },
  {
    kind: "EVENT",
    title: b("Last day of Term 1", "اليوم الأخير من الفصل الدراسي الأول"),
    description: b("Students finish at 12:00.", "ينتهي دوام الطلاب الساعة 12:00 ظهراً."),
    dayOffset: 74,
    startHour: 7,
    durationHours: 5,
    audience: ["all"],
  },
];

type CaseType = "ACADEMIC" | "BEHAVIOR" | "WELLBEING" | "CAREER" | "LEARNING_SUPPORT" | "ATTENDANCE" | "PARENT_CONCERN";
type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export const CASE_STORIES: Array<{ type: CaseType; title: Bi; summary: Bi; notes: string[]; priority: Priority }> = [
  {
    type: "ACADEMIC",
    title: b("Decline in Mathematics grades", "تراجع في درجات الرياضيات"),
    summary: b(
      "Student's Mathematics assessment scores have dropped from a B to a D over the last half term.",
      "تراجعت درجات الطالب في تقييمات الرياضيات من مستوى B إلى D خلال نصف الفصل الأخير.",
    ),
    notes: [
      "Class teacher reports homework is often incomplete since September.",
      "Spoke with student; he finds the algebra unit difficult and has stopped asking questions in class.",
      "Enrolled in Tuesday lunchtime maths clinic. Review progress in three weeks.",
    ],
    priority: "MEDIUM",
  },
  {
    type: "ACADEMIC",
    title: b("Missing coursework in Design and Technology", "أعمال مقررة غير مسلّمة في مادة التصميم والتكنولوجيا"),
    summary: b(
      "Two coursework milestones are outstanding and the internal deadline is approaching.",
      "لم تُسلَّم مرحلتان من الأعمال المقررة، والموعد الداخلي للتسليم يقترب.",
    ),
    notes: [
      "DT teacher confirmed portfolio sections 2 and 3 are not submitted.",
      "Student has agreed a catch-up plan with weekly check-ins.",
    ],
    priority: "HIGH",
  },
  {
    type: "ACADEMIC",
    title: b("Gifted and talented extension in Physics", "إثراء الطلبة الموهوبين في مادة الفيزياء"),
    summary: b(
      "Student is consistently working well beyond grade level and would benefit from extension work.",
      "يعمل الطالب باستمرار بمستوى يفوق صفه الدراسي، وسيستفيد من أنشطة إثرائية إضافية.",
    ),
    notes: [
      "Physics teacher recommends the Physics Olympiad preparation group.",
      "Parents are supportive and keen for additional challenge.",
      "Registered for the regional Olympiad in November.",
    ],
    priority: "LOW",
  },
  {
    type: "ACADEMIC",
    title: b("Adjusting to the English curriculum", "التأقلم مع المنهج البريطاني"),
    summary: b(
      "Student joined from a different curriculum this term and is finding essay-based subjects challenging.",
      "انضمت الطالبة هذا الفصل قادمة من منهج مختلف، وتجد صعوبة في المواد التي تعتمد على كتابة المقالات.",
    ),
    notes: [
      "History and English teachers report strong ideas but unfamiliarity with structured essay writing.",
      "Paired with a peer mentor from the same tutor group.",
      "Shared essay-planning scaffolds with the student and her parents.",
    ],
    priority: "MEDIUM",
  },
  {
    type: "BEHAVIOR",
    title: b("Repeated disruption in afternoon lessons", "إخلال متكرر بسير الحصص المسائية"),
    summary: b(
      "Several teachers have logged low-level disruption, mainly in period 5 and 6 lessons.",
      "سجّل عدد من المعلمين سلوكيات مُخلّة بسيطة، معظمها في الحصتين الخامسة والسادسة.",
    ),
    notes: [
      "Five behaviour logs in two weeks, all low-level talking and off-task behaviour.",
      "Restorative conversation held with the student and tutor.",
      "Placed on a two-week tutor report with daily targets.",
    ],
    priority: "MEDIUM",
  },
  {
    type: "BEHAVIOR",
    title: b("Mobile phone use during lessons", "استخدام الهاتف المحمول أثناء الحصص"),
    summary: b(
      "Student's phone has been confiscated three times this term, contrary to the device policy.",
      "صودر هاتف الطالب ثلاث مرات هذا الفصل بما يخالف سياسة استخدام الأجهزة.",
    ),
    notes: [
      "Third confiscation logged by the Geography teacher.",
      "Parents contacted and phone returned to them in person, as per policy.",
    ],
    priority: "LOW",
  },
  {
    type: "BEHAVIOR",
    title: b("Unkind comments in a group chat", "تعليقات غير لائقة في مجموعة محادثة"),
    summary: b(
      "A group of Grade 8 students reported hurtful comments posted in a class group chat outside school.",
      "أبلغت مجموعة من طلاب الصف الثامن عن تعليقات جارحة نُشرت في مجموعة محادثة صفية خارج أوقات الدوام.",
    ),
    notes: [
      "Screenshots shared by two students and saved to the case file.",
      "Met with the students involved; they acknowledged the impact of their messages.",
      "Parents of all students informed. Digital citizenship session scheduled for the tutor group.",
    ],
    priority: "HIGH",
  },
  {
    type: "BEHAVIOR",
    title: b("Uniform and punctuality reminders", "تنبيهات بشأن الزي المدرسي والالتزام بالمواعيد"),
    summary: b(
      "Student has received repeated reminders about uniform standards and arriving late to registration.",
      "تلقى الطالب تنبيهات متكررة بشأن معايير الزي المدرسي والتأخر عن تسجيل الحضور الصباحي.",
    ),
    notes: [
      "Tutor has issued four uniform reminders this month.",
      "Student explained that his blazer no longer fits; family is ordering a replacement.",
    ],
    priority: "LOW",
  },
  {
    type: "WELLBEING",
    title: b("Exam stress ahead of mock examinations", "ضغط نفسي قبل الامتحانات التجريبية"),
    summary: b(
      "Student has shared that she is feeling overwhelmed by revision and is struggling to sleep.",
      "أفادت الطالبة بأنها تشعر بضغط كبير بسبب المراجعة وتواجه صعوبة في النوم.",
    ),
    notes: [
      "Self-referred to the counsellor after a tutor time session on wellbeing.",
      "Worked together on a realistic revision timetable with regular breaks.",
      "Follow-up session booked for next week. Parents aware and supportive.",
    ],
    priority: "MEDIUM",
  },
  {
    type: "WELLBEING",
    title: b("Settling in after relocation to Dubai", "التأقلم بعد الانتقال إلى دبي"),
    summary: b(
      "Student moved from Canada in August and has mentioned feeling homesick and missing old friends.",
      "انتقل الطالب من كندا في شهر أغسطس، وذكر أنه يشعر بالحنين إلى وطنه ويفتقد أصدقاءه القدامى.",
    ),
    notes: [
      "Tutor noticed the student often spends break times alone.",
      "Introduced to the robotics club and a buddy from the same class.",
      "Student reports feeling more settled at the two-week check-in.",
    ],
    priority: "LOW",
  },
  {
    type: "WELLBEING",
    title: b("Friendship difficulties in tutor group", "خلافات بين الصديقات في مجموعة الإرشاد الصفي"),
    summary: b(
      "A falling out within a friendship group has left the student feeling isolated at school.",
      "أدى خلاف داخل مجموعة من الصديقات إلى شعور الطالبة بالعزلة في المدرسة.",
    ),
    notes: [
      "Student spoke to her tutor after an upsetting lunchtime.",
      "Counsellor facilitated a calm conversation between the girls involved.",
      "Monitoring for two weeks. Student says things are improving.",
    ],
    priority: "MEDIUM",
  },
  {
    type: "WELLBEING",
    title: b("Low mood following a family bereavement", "انخفاض في المعنويات بعد وفاة أحد أفراد الأسرة"),
    summary: b(
      "Student's grandfather passed away recently and she has been quieter than usual in lessons.",
      "توفي جدّ الطالبة مؤخراً، ولوحظ أنها أكثر هدوءاً من المعتاد في الحصص.",
    ),
    notes: [
      "Mother informed the school and asked teachers to be understanding with deadlines.",
      "Teachers notified to allow flexibility with homework for two weeks.",
      "Counsellor has offered weekly check-ins; student accepted.",
    ],
    priority: "HIGH",
  },
  {
    type: "WELLBEING",
    title: b("Anxiety about public speaking", "القلق من التحدث أمام الجمهور"),
    summary: b(
      "Student becomes very anxious before class presentations and has asked to be excused.",
      "يشعر الطالب بقلق شديد قبل العروض التقديمية الصفية، وطلب إعفاءه منها.",
    ),
    notes: [
      "English teacher agreed that the student can present to a smaller group first.",
      "Counsellor shared simple breathing techniques to use before presentations.",
    ],
    priority: "LOW",
  },
  {
    type: "WELLBEING",
    title: b("Balancing competitive swimming and study", "الموازنة بين السباحة التنافسية والدراسة"),
    summary: b(
      "Student trains early every morning and is showing signs of fatigue in lessons.",
      "يتدرّب الطالب في وقت مبكر كل صباح، وتظهر عليه علامات الإرهاق خلال الحصص.",
    ),
    notes: [
      "Several teachers noticed the student falling asleep in period 1.",
      "Met with the student and parents to discuss training load and rest.",
      "Agreed weekly planner check-ins with the tutor.",
    ],
    priority: "MEDIUM",
  },
  {
    type: "CAREER",
    title: b("Medicine application guidance", "إرشاد بشأن التقديم لدراسة الطب"),
    summary: b(
      "Grade 12 student is applying for Medicine in the UK and needs support with UCAT preparation and interviews.",
      "طالبة في الصف الثاني عشر تتقدم لدراسة الطب في المملكة المتحدة، وتحتاج إلى دعم في التحضير لاختبار UCAT والمقابلات.",
    ),
    notes: [
      "UCAT score received and discussed; competitive for most of her choices.",
      "Personal statement second draft reviewed with the student.",
      "Mock interview arranged with a parent volunteer who is a doctor.",
    ],
    priority: "HIGH",
  },
  {
    type: "CAREER",
    title: b("Exploring engineering pathways", "استكشاف مسارات الهندسة"),
    summary: b(
      "Student is interested in engineering but unsure which discipline suits him best.",
      "يهتم الطالب بدراسة الهندسة لكنه غير متأكد من التخصص الأنسب له.",
    ),
    notes: [
      "Completed the careers interest profile in the guidance platform.",
      "Suggested attending the university fair and a virtual taster lecture.",
    ],
    priority: "LOW",
  },
  {
    type: "CAREER",
    title: b("Work experience placement request", "طلب فرصة تدريب ميداني"),
    summary: b(
      "Grade 11 student would like a work experience placement in architecture during the spring break.",
      "يرغب طالب في الصف الحادي عشر في الحصول على فرصة تدريب ميداني في مجال العمارة خلال عطلة الربيع.",
    ),
    notes: [
      "Contacted two architecture firms from our partner list.",
      "Student has prepared a CV and cover letter with support from the careers team.",
    ],
    priority: "LOW",
  },
  {
    type: "CAREER",
    title: b("US university application timeline", "الجدول الزمني للتقديم إلى الجامعات الأمريكية"),
    summary: b(
      "Student plans to apply Early Action to three US universities and has not yet finalised essays.",
      "يخطط الطالب للتقديم المبكر إلى ثلاث جامعات أمريكية، ولم ينتهِ بعد من كتابة المقالات.",
    ),
    notes: [
      "Common App essay first draft received; needs a clearer personal focus.",
      "Teacher recommendation requests sent to Mathematics and Economics.",
      "Deadline tracker shared with the student and parents.",
    ],
    priority: "HIGH",
  },
  {
    type: "LEARNING_SUPPORT",
    title: b("Access arrangements for dyslexia", "ترتيبات الامتحانات لطالب يعاني من عسر القراءة"),
    summary: b(
      "Student has an updated educational psychologist report recommending extra time and a reader.",
      "حصل الطالب على تقرير محدّث من أخصائي نفسي تربوي يوصي بمنحه وقتاً إضافياً وقارئاً في الامتحانات.",
    ),
    notes: [
      "Report received from parents and uploaded to the student file.",
      "Exams officer informed so that arrangements are in place for mock examinations.",
      "Individual learning plan updated and shared with all teachers.",
    ],
    priority: "HIGH",
  },
  {
    type: "LEARNING_SUPPORT",
    title: b("English as an additional language support", "دعم اللغة الإنجليزية بوصفها لغة إضافية"),
    summary: b(
      "Student recently arrived from Korea and is developing academic English.",
      "وصل الطالب مؤخراً من كوريا ويعمل على تطوير مهاراته في اللغة الإنجليزية الأكاديمية.",
    ),
    notes: [
      "Baseline language assessment completed.",
      "Timetabled for three EAL sessions per week in place of French.",
      "Teachers provided with key vocabulary lists for each subject.",
    ],
    priority: "MEDIUM",
  },
  {
    type: "LEARNING_SUPPORT",
    title: b("Attention and organisation strategies", "استراتيجيات لتعزيز التركيز والتنظيم"),
    summary: b(
      "Teachers report that the student finds it hard to stay focused and often forgets equipment.",
      "يفيد المعلمون بأن الطالب يجد صعوبة في الحفاظ على تركيزه وكثيراً ما ينسى أدواته المدرسية.",
    ),
    notes: [
      "Learning support teacher observed two lessons.",
      "Introduced a visual checklist and seating near the front of the class.",
      "Parents asked whether an external assessment might be helpful; guidance shared.",
    ],
    priority: "MEDIUM",
  },
  {
    type: "LEARNING_SUPPORT",
    title: b("Reading comprehension intervention", "برنامج علاجي لتعزيز الفهم القرائي"),
    summary: b(
      "Standardised reading scores are below age-related expectations.",
      "جاءت نتائج الطالب في اختبارات القراءة المعيارية دون المستوى المتوقع لعمره.",
    ),
    notes: [
      "Added to the small group reading intervention twice a week.",
      "Progress will be reviewed after six weeks using the same assessment.",
    ],
    priority: "MEDIUM",
  },
  {
    type: "ATTENDANCE",
    title: b("Attendance below 90 percent", "انخفاض نسبة الحضور عن 90%"),
    summary: b(
      "Student's attendance has fallen to 87 percent this term, mostly single days on Mondays.",
      "انخفضت نسبة حضور الطالب إلى 87% هذا الفصل، ومعظم الغياب أيام متفرقة يوم الاثنين.",
    ),
    notes: [
      "Attendance letter sent to parents in line with school policy.",
      "Parents explained recurring headaches; advised to consult their doctor.",
      "Nurse informed and attendance to be reviewed in four weeks.",
    ],
    priority: "HIGH",
  },
  {
    type: "ATTENDANCE",
    title: b("Frequent late arrivals", "تأخر متكرر في الحضور الصباحي"),
    summary: b(
      "Student has arrived after registration eight times in the last three weeks.",
      "وصل الطالب بعد تسجيل الحضور ثماني مرات خلال الأسابيع الثلاثة الماضية.",
    ),
    notes: [
      "Family explained that the new school bus route is running late.",
      "Transport team contacted to review the route timings.",
    ],
    priority: "LOW",
  },
  {
    type: "ATTENDANCE",
    title: b("Extended absence for family travel", "غياب مطوّل بسبب سفر عائلي"),
    summary: b(
      "Parents have requested a two-week absence during term time for a family event overseas.",
      "طلب ولي الأمر غياب الطالب لمدة أسبوعين خلال الفصل الدراسي لحضور مناسبة عائلية خارج الدولة.",
    ),
    notes: [
      "Request received through the parent portal.",
      "Head of Secondary discussed the impact on learning and KHDA attendance expectations with the family.",
      "Teachers asked to share work for the absence period.",
    ],
    priority: "MEDIUM",
  },
  {
    type: "PARENT_CONCERN",
    title: b("Concern about homework workload", "ملاحظة بشأن كثافة الواجبات المنزلية"),
    summary: b(
      "Parent feels that the amount of homework in Grade 9 is affecting family time and sleep.",
      "يرى ولي الأمر أن كمية الواجبات المنزلية في الصف التاسع تؤثر في وقت الأسرة ونوم ابنه.",
    ),
    notes: [
      "Phone call with the father to listen to his concerns.",
      "Reviewed the homework timetable with the Grade 9 team; two subjects were overlapping.",
      "Adjusted schedule shared with the family, who were appreciative.",
    ],
    priority: "MEDIUM",
  },
  {
    type: "PARENT_CONCERN",
    title: b("Request for feedback on Arabic progress", "طلب متابعة مستوى الطالب في اللغة العربية"),
    summary: b(
      "Parent would like more regular updates on her son's progress in Arabic as a first language.",
      "ترغب ولية الأمر في الحصول على تحديثات منتظمة حول مستوى ابنها في مادة اللغة العربية للناطقين بها.",
    ),
    notes: [
      "Arabic teacher agreed to send a short fortnightly update by email.",
      "Reading list for the term shared with the family.",
    ],
    priority: "LOW",
  },
  {
    type: "PARENT_CONCERN",
    title: b("Concern about set placement in Mathematics", "ملاحظة بشأن تصنيف الطالب في مجموعات الرياضيات"),
    summary: b(
      "Parents are concerned that their daughter has been placed in a lower Mathematics set this year.",
      "أبدى ولي الأمر قلقه من وضع ابنته في مجموعة رياضيات ذات مستوى أقل هذا العام.",
    ),
    notes: [
      "Head of Mathematics shared the baseline data used for set placement.",
      "Agreed to review placement after the November assessment.",
    ],
    priority: "MEDIUM",
  },
  {
    type: "PARENT_CONCERN",
    title: b("School bus behaviour concern", "ملاحظة بشأن السلوك في الحافلة المدرسية"),
    summary: b(
      "Parent reports that her daughter feels uncomfortable because of loud behaviour on the afternoon bus.",
      "أفادت ولية الأمر بأن ابنتها تشعر بعدم الارتياح بسبب الضوضاء والسلوك غير المنضبط في حافلة الظهيرة.",
    ),
    notes: [
      "Transport coordinator spoke with the bus supervisor.",
      "Seating plan introduced on route 7 with older students seated at the back.",
      "Follow-up call with the parent planned for next week.",
    ],
    priority: "MEDIUM",
  },
  {
    type: "ACADEMIC",
    title: b("Predicted grades below university offer requirements", "الدرجات المتوقعة أقل من متطلبات القبول الجامعي"),
    summary: b(
      "Student's predicted grades are one grade below the typical offers for his first-choice universities.",
      "الدرجات المتوقعة للطالب أقل بدرجة واحدة من شروط القبول المعتادة في الجامعات التي يفضّلها.",
    ),
    notes: [
      "Discussed a balanced list including one aspirational and two secure choices.",
      "Subject teachers to share targeted revision priorities before the mock examinations.",
      "Parents invited to a meeting with the university guidance counsellor.",
    ],
    priority: "HIGH",
  },
];

export const TASK_TITLES: Bi[] = [
  b("Call parents to follow up on attendance", "الاتصال بولي الأمر لمتابعة الحضور"),
  b("Share updated learning plan with subject teachers", "مشاركة خطة التعلّم المحدّثة مع معلمي المواد"),
  b("Book follow-up counselling session", "حجز جلسة إرشاد للمتابعة"),
  b("Review personal statement draft", "مراجعة مسودة البيان الشخصي"),
  b("Upload teacher reference to UCAS", "رفع توصية المعلم إلى نظام UCAS"),
  b("Arrange meeting with parents and tutor", "ترتيب اجتماع مع ولي الأمر والمرشد الصفي"),
  b("Confirm exam access arrangements with exams officer", "تأكيد ترتيبات الامتحانات مع مسؤول الامتحانات"),
  b("Send weekly progress update to family", "إرسال التحديث الأسبوعي للأسرة"),
  b("Check homework completion with class teacher", "التحقق من إنجاز الواجبات مع معلم المادة"),
  b("Add student to lunchtime maths clinic", "تسجيل الطالب في حصة دعم الرياضيات وقت الاستراحة"),
  b("Review tutor report targets at end of week", "مراجعة أهداف تقرير المتابعة في نهاية الأسبوع"),
  b("Prepare work pack for approved absence", "إعداد ملف الواجبات لفترة الغياب المعتمد"),
  b("Contact transport team about bus route timings", "التواصل مع فريق النقل بشأن مواعيد خط الحافلة"),
  b("Observe student in two lessons", "حضور حصتين لملاحظة الطالب"),
  b("Schedule restorative conversation", "تحديد موعد لحوار إصلاحي"),
  b("Update case notes after parent call", "تحديث ملاحظات الحالة بعد الاتصال بولي الأمر"),
  b("Send attendance letter in line with policy", "إرسال خطاب الحضور وفق سياسة المدرسة"),
  b("Arrange peer mentor for new student", "تعيين زميل مرشد للطالب الجديد"),
  b("Request educational psychologist report from family", "طلب تقرير الأخصائي النفسي التربوي من الأسرة"),
  b("Review reading intervention progress", "مراجعة تقدم الطالب في برنامج القراءة العلاجي"),
  b("Confirm work experience placement with employer", "تأكيد فرصة التدريب الميداني مع جهة العمل"),
  b("Arrange mock interview for Medicine applicant", "ترتيب مقابلة تجريبية لطالبة تتقدم لدراسة الطب"),
  b("Check in with student after two weeks", "متابعة الطالب بعد أسبوعين"),
  b("Inform teachers of temporary deadline flexibility", "إبلاغ المعلمين بمنح مرونة مؤقتة في مواعيد التسليم"),
  b("Review Mathematics set placement after assessment", "مراجعة تصنيف مجموعة الرياضيات بعد التقييم"),
  b("Share revision timetable template with student", "مشاركة نموذج جدول المراجعة مع الطالب"),
  b("Log outcome of meeting in student file", "توثيق نتائج الاجتماع في ملف الطالب"),
  b("Refer to nurse for health follow-up", "إحالة الطالب إلى الممرضة لمتابعة حالته الصحية"),
  b("Send recommendation request reminder to teachers", "إرسال تذكير للمعلمين بطلبات التوصية"),
  b("Close case and notify pastoral team", "إغلاق الحالة وإبلاغ فريق الرعاية الطلابية"),
];

export const REQUEST_NOTES: Record<string, Bi[]> = {
  document_request: [
    b("Enrollment letter for residence visa renewal", "خطاب قيد لتجديد تأشيرة الإقامة"),
    b("Attested transcript for university application", "كشف درجات مصدّق لطلب الالتحاق بالجامعة"),
    b("Letter of good conduct for scholarship application", "شهادة حسن سيرة وسلوك لطلب منحة دراسية"),
    b("Transfer certificate for relocation abroad", "شهادة انتقال بسبب الانتقال إلى خارج الدولة"),
  ],
  it_support: [
    b("Unable to log in to the learning platform", "تعذّر تسجيل الدخول إلى منصة التعلم"),
    b("School laptop keyboard not working", "لوحة مفاتيح الحاسوب المحمول المدرسي لا تعمل"),
    b("Password reset for student email account", "إعادة تعيين كلمة مرور البريد الإلكتروني للطالب"),
    b("Printer access needed for coursework", "طلب صلاحية استخدام الطابعة لطباعة الأعمال المقررة"),
  ],
  absence_request: [
    b("Medical appointment on Thursday morning", "موعد طبي صباح يوم الخميس"),
    b("Family wedding abroad, two days", "حضور حفل زفاف عائلي خارج الدولة لمدة يومين"),
    b("Representing the UAE at a swimming championship", "تمثيل دولة الإمارات في بطولة للسباحة"),
    b("University interview in London", "مقابلة جامعية في لندن"),
  ],
  activity_registration: [
    b("Join the robotics club this term", "الانضمام إلى نادي الروبوتات هذا الفصل"),
    b("Register for Model United Nations conference", "التسجيل في مؤتمر نموذج الأمم المتحدة"),
    b("Sign up for the Duke of Edinburgh's Award", "التسجيل في برنامج جائزة دوق إدنبرة"),
    b("Place in the senior girls' football team", "طلب الانضمام إلى فريق كرة القدم للطالبات في المرحلة العليا"),
  ],
  locker_request: [
    b("New locker near the science block", "طلب خزانة جديدة بالقرب من مبنى العلوم"),
    b("Replacement key for locker", "طلب مفتاح بديل للخزانة"),
    b("Locker door is jammed", "باب الخزانة عالق ولا يُفتح"),
    b("Request to share a locker with sibling", "طلب مشاركة الخزانة مع الأخ"),
  ],
  feedback: [
    b("Suggestion for more healthy options in the canteen", "اقتراح بزيادة الخيارات الصحية في المقصف"),
    b("Thank you to the Grade 10 tutor team", "شكر وتقدير لفريق المرشدين في الصف العاشر"),
    b("Feedback on the parent-teacher conference booking system", "ملاحظات حول نظام حجز لقاءات أولياء الأمور والمعلمين"),
    b("Idea for a student-led Arabic reading club", "مقترح لإنشاء نادٍ للقراءة العربية يديره الطلاب"),
  ],
  transport_request: [
    b("Change of bus stop after moving house", "تغيير موقف الحافلة بعد الانتقال إلى منزل جديد"),
    b("Late bus for after-school activities on Tuesdays", "حافلة متأخرة لطلاب الأنشطة بعد الدوام أيام الثلاثاء"),
    b("Cancel bus service from next month", "إلغاء خدمة الحافلة اعتباراً من الشهر المقبل"),
    b("Temporary drop-off at grandparents' home", "توصيل مؤقت إلى منزل الجدّين"),
  ],
  id_card_replacement: [
    b("Lost student ID card", "فقدان بطاقة الطالب التعريفية"),
    b("Damaged ID card no longer scans at the gate", "البطاقة التعريفية تالفة ولا تعمل عند البوابة"),
    b("Update photo on student ID card", "تحديث الصورة على بطاقة الطالب التعريفية"),
    b("Name spelling correction on ID card", "تصحيح تهجئة الاسم على البطاقة التعريفية"),
  ],
};
