import type { FieldOption, FormField, FormStep, FormTemplate, I18nText } from "@/server/forms/schema";

// Form templates for every service in the catalogue. One template per service; the template key equals the service key.

const t = (en: string, ar: string): I18nText => ({ en, ar });
const o = (value: string, en: string, ar: string): FieldOption => ({ value, label: t(en, ar) });

const CATEGORY: Record<string, I18nText> = {
  academic: t("Academics", "الشؤون الأكاديمية"),
  wellbeing: t("Wellbeing", "الرفاه والدعم النفسي"),
  careers: t("Careers and University", "الإرشاد المهني والجامعي"),
  documents: t("Documents and Letters", "الوثائق والخطابات"),
  meetings: t("Meetings", "الاجتماعات والمواعيد"),
  attendance: t("Attendance", "الحضور والغياب"),
  technology: t("Technology", "الدعم التقني"),
  campus_life: t("Campus Life", "الحياة المدرسية"),
  safeguarding: t("Safeguarding", "حماية الطفل"),
  feedback: t("Feedback", "الملاحظات والاقتراحات"),
  staff_operations: t("Staff Operations", "خدمات الموظفين"),
};

function form(
  key: string,
  category: keyof typeof CATEGORY,
  name: I18nText,
  description: I18nText,
  steps: FormStep[],
  submitLabel?: I18nText,
): FormTemplate {
  return {
    key,
    name,
    description,
    category: CATEGORY[category],
    schema: { version: 1, steps, ...(submitLabel ? { submitLabel } : {}) },
  };
}

// Shared fields

const studentName = (): FormField => ({
  id: "studentName",
  type: "short_text",
  label: t("Student name", "اسم الطالب"),
  prefill: "student.fullName",
  readOnly: true,
  width: "half",
});

const studentGrade = (): FormField => ({
  id: "grade",
  type: "short_text",
  label: t("Grade", "الصف"),
  prefill: "student.grade",
  readOnly: true,
  width: "half",
});

const requesterName = (): FormField => ({
  id: "requesterName",
  type: "short_text",
  label: t("Your name", "الاسم"),
  prefill: "requester.name",
  readOnly: true,
  width: "half",
});

const studentPicker = (): FormField => ({
  id: "student",
  type: "student_picker",
  label: t("Student", "الطالب"),
  required: true,
});

const URGENCY_OPTIONS: FieldOption[] = [
  o("low", "Low", "منخفضة"),
  o("medium", "Medium", "متوسطة"),
  o("high", "High", "عالية"),
];

const ACTIVITY_OPTIONS: FieldOption[] = [
  o("football", "Football", "كرة القدم"),
  o("basketball", "Basketball", "كرة السلة"),
  o("swimming", "Swimming", "السباحة"),
  o("robotics", "Robotics", "الروبوتات"),
  o("model_un", "Model United Nations", "نموذج الأمم المتحدة"),
  o("debate", "Debate club", "نادي المناظرات"),
  o("arabic_calligraphy", "Arabic calligraphy", "الخط العربي"),
  o("drama", "Drama", "المسرح"),
  o("eco_club", "Eco club", "نادي البيئة"),
  o("coding", "Coding club", "نادي البرمجة"),
];

export const FORM_TEMPLATES: FormTemplate[] = [
  // ───────────────────────── Student services ─────────────────────────
  form(
    "career_guidance",
    "careers",
    t("Career guidance session", "جلسة إرشاد مهني"),
    t(
      "Tell your career advisor a little about yourself so your session is as useful as possible.",
      "حدّث المرشد المهني قليلًا عن نفسك لتكون الجلسة مفيدة قدر الإمكان.",
    ),
    [
      {
        id: "about_you",
        title: t("About you", "عنك"),
        sections: [
          { id: "student_details", fields: [studentName(), studentGrade()] },
          {
            id: "interests_section",
            title: t("Your interests", "اهتماماتك"),
            fields: [
              {
                id: "interests",
                type: "multi_select",
                label: t("Which areas interest you?", "ما المجالات التي تثير اهتمامك؟"),
                help: t("Choose as many as you like.", "يمكنك اختيار أكثر من مجال."),
                required: true,
                options: [
                  o("sciences", "Sciences", "العلوم"),
                  o("engineering_tech", "Engineering and technology", "الهندسة والتكنولوجيا"),
                  o("medicine_health", "Medicine and health", "الطب والصحة"),
                  o("business", "Business and finance", "إدارة الأعمال والمالية"),
                  o("law_politics", "Law and politics", "القانون والعلوم السياسية"),
                  o("arts_design", "Arts and design", "الفنون والتصميم"),
                  o("media", "Media and communication", "الإعلام والاتصال"),
                  o("education", "Education", "التعليم"),
                  o("sports", "Sport and fitness", "الرياضة واللياقة"),
                  o("hospitality", "Hospitality and tourism", "الضيافة والسياحة"),
                ],
              },
              {
                id: "careerIdeas",
                type: "long_text",
                label: t("Do you have any career ideas already?", "هل لديك أفكار عن مهنة معيّنة؟"),
                placeholder: t("It is fine to say you are not sure yet.", "لا بأس إن لم تكن متأكدًا بعد."),
                maxLength: 1000,
              },
            ],
          },
        ],
      },
      {
        id: "plans",
        title: t("Your plans", "خططك"),
        sections: [
          {
            id: "study_abroad",
            title: t("Where would you like to study?", "أين تودّ أن تكمل دراستك؟"),
            fields: [
              {
                id: "preferredCountries",
                type: "multi_select",
                label: t("Preferred countries", "الدول المفضّلة"),
                options: [
                  o("AE", "United Arab Emirates", "الإمارات العربية المتحدة"),
                  o("GB", "United Kingdom", "المملكة المتحدة"),
                  o("US", "United States", "الولايات المتحدة"),
                  o("CA", "Canada", "كندا"),
                  o("NL", "Netherlands", "هولندا"),
                  o("DE", "Germany", "ألمانيا"),
                  o("other", "Somewhere else", "دولة أخرى"),
                ],
              },
              {
                id: "otherCountry",
                type: "short_text",
                label: t("Which other country?", "ما الدولة الأخرى؟"),
                showIf: { fieldId: "preferredCountries", op: "contains", value: "other" },
              },
              {
                id: "questions",
                type: "long_text",
                label: t("What would you like to ask your advisor?", "ما الأسئلة التي تودّ طرحها على المرشد؟"),
                maxLength: 1000,
              },
              {
                id: "shareWithParent",
                type: "yes_no",
                label: t("Can we share a summary of the session with your parent?", "هل توافق على مشاركة ملخص الجلسة مع ولي أمرك؟"),
              },
            ],
          },
        ],
      },
    ],
    t("Request session", "اطلب الجلسة"),
  ),

  form(
    "academic_support",
    "academic",
    t("Ask for academic support", "طلب دعم أكاديمي"),
    t("Tell us which subject is difficult and what would help.", "أخبرنا بالمادة التي تجد فيها صعوبة وما الذي قد يساعدك."),
    [
      {
        id: "support_request",
        title: t("Your request", "طلبك"),
        sections: [
          { id: "student_details", fields: [studentName(), studentGrade()] },
          {
            id: "subject_section",
            title: t("Where do you need help?", "في أي جانب تحتاج إلى المساعدة؟"),
            fields: [
              { id: "subject", type: "subject_picker", label: t("Subject", "المادة"), required: true },
              {
                id: "difficulties",
                type: "multi_select",
                label: t("What is difficult right now?", "ما الذي تجده صعبًا حاليًا؟"),
                required: true,
                options: [
                  o("understanding_content", "Understanding the lessons", "فهم الدروس"),
                  o("homework", "Completing homework", "إنجاز الواجبات"),
                  o("exam_preparation", "Preparing for exams", "الاستعداد للامتحانات"),
                  o("time_management", "Managing my time", "تنظيم الوقت"),
                  o("keeping_up", "Keeping up with the class", "مواكبة زملائي في الصف"),
                ],
              },
              {
                id: "confidence",
                type: "scale",
                label: t("How confident do you feel in this subject?", "ما مدى ثقتك بنفسك في هذه المادة؟"),
                help: t("1 means not confident at all, 10 means very confident.", "الرقم 1 يعني عدم الثقة إطلاقًا، والرقم 10 يعني ثقة عالية جدًا."),
                min: 1,
                max: 10,
              },
              {
                id: "preferredSupport",
                type: "radio",
                label: t("What kind of support would help most?", "ما نوع الدعم الذي سيساعدك أكثر؟"),
                options: [
                  o("teacher_session", "Extra session with my teacher", "حصة إضافية مع معلمي"),
                  o("peer_tutoring", "Peer tutoring", "مساعدة من زميل متفوّق"),
                  o("study_skills", "Study skills workshop", "ورشة مهارات الدراسة"),
                  o("not_sure", "I am not sure", "لست متأكدًا"),
                ],
              },
              {
                id: "details",
                type: "long_text",
                label: t("Anything else we should know?", "هل هناك ما تودّ إضافته؟"),
                maxLength: 1000,
              },
            ],
          },
        ],
      },
    ],
  ),

  form(
    "subject_change",
    "academic",
    t("Subject change request", "طلب تغيير مادة دراسية"),
    t(
      "Request to swap a subject. Your advisor and the Head of Department will review it with you.",
      "قدّم طلبًا لاستبدال إحدى المواد، وسيراجعه معك المرشد الأكاديمي ورئيس القسم.",
    ),
    [
      {
        id: "the_change",
        title: t("The change", "التغيير المطلوب"),
        sections: [
          { id: "student_details", fields: [studentName(), studentGrade()] },
          {
            id: "subjects",
            title: t("Subjects", "المواد"),
            fields: [
              {
                id: "fromSubject",
                type: "subject_picker",
                label: t("Subject you want to drop", "المادة التي تريد التوقف عن دراستها"),
                placeholder: t("For example, Physics", "مثال: الفيزياء"),
                required: true,
                width: "half",
              },
              {
                id: "toSubject",
                type: "subject_picker",
                label: t("Subject you want to take instead", "المادة التي تريد دراستها بدلًا منها"),
                required: true,
                width: "half",
              },
            ],
          },
        ],
      },
      {
        id: "reasons",
        title: t("Your reasons", "أسباب الطلب"),
        sections: [
          {
            id: "reason_section",
            fields: [
              {
                id: "reason",
                type: "select",
                label: t("Main reason for the change", "السبب الرئيسي للتغيير"),
                required: true,
                options: [
                  o("interest", "I am more interested in the new subject", "اهتمامي بالمادة الجديدة أكبر"),
                  o("career", "It fits my career or university plans", "تتناسب مع خططي المهنية أو الجامعية"),
                  o("workload", "My current workload is too heavy", "العبء الدراسي الحالي كبير"),
                  o("other", "Other", "سبب آخر"),
                ],
              },
              {
                id: "reasonDetail",
                type: "long_text",
                label: t("Please explain your reason", "يرجى توضيح السبب"),
                required: true,
                maxLength: 1000,
                showIf: { fieldId: "reason", op: "eq", value: "other" },
              },
              {
                id: "careerLink",
                type: "short_text",
                label: t("Which course or career is this linked to? (optional)", "بأي تخصص أو مهنة يرتبط هذا التغيير؟ (اختياري)"),
                placeholder: t("For example, Architecture", "مثال: الهندسة المعمارية"),
              },
              {
                id: "parentAware",
                type: "yes_no",
                label: t("Is your parent or guardian aware of this request?", "هل ولي أمرك على علم بهذا الطلب؟"),
                required: true,
              },
              {
                id: "timingNote",
                type: "statement",
                label: t(
                  "Changes requested after the fourth week of term may also need the Principal's approval and depend on space in the new class.",
                  "قد تحتاج الطلبات المقدّمة بعد الأسبوع الرابع من الفصل الدراسي إلى موافقة مدير المدرسة، وتعتمد على توفّر مقعد في الصف الجديد.",
                ),
              },
            ],
          },
        ],
      },
    ],
  ),

  form(
    "document_request",
    "documents",
    t("School document request", "طلب وثيقة مدرسية"),
    t(
      "Official letters are signed and stamped by the Registrar. Most documents are ready within three working days.",
      "يوقّع مسجّل المدرسة على الخطابات الرسمية ويختمها، وتكون معظم الوثائق جاهزة خلال ثلاثة أيام عمل.",
    ),
    [
      {
        id: "document",
        title: t("Document details", "بيانات الوثيقة"),
        sections: [
          { id: "people", fields: [requesterName(), studentName()] },
          {
            id: "document_section",
            fields: [
              {
                id: "documentType",
                type: "radio",
                label: t("Which document do you need?", "ما الوثيقة التي تحتاجها؟"),
                required: true,
                options: [
                  o("enrollment_letter", "Enrollment letter", "شهادة قيد"),
                  o("transcript", "Academic transcript", "كشف درجات"),
                  o("good_conduct", "Good conduct certificate", "شهادة حسن سيرة وسلوك"),
                  o("bus_pass_letter", "Bus pass letter", "خطاب لبطاقة المواصلات"),
                ],
              },
              {
                id: "language",
                type: "radio",
                label: t("Language", "لغة الوثيقة"),
                help: t("Bilingual documents are accepted by most UAE authorities. Choose bilingual if you are unsure.", "تقبل معظم الجهات في الدولة الوثائق ثنائية اللغة، فاخترها إن لم تكن متأكدًا."),
                required: true,
                options: [
                  o("en", "English", "الإنجليزية"),
                  o("ar", "Arabic", "العربية"),
                  o("bilingual", "Bilingual (English and Arabic)", "ثنائية اللغة (العربية والإنجليزية)"),
                ],
              },
            ],
          },
        ],
      },
      {
        id: "purpose_delivery",
        title: t("Purpose and delivery", "الغرض والاستلام"),
        sections: [
          {
            id: "purpose_section",
            fields: [
              {
                id: "purpose",
                type: "select",
                label: t("What is it for?", "ما الغرض من الوثيقة؟"),
                required: true,
                options: [
                  o("visa", "Residence visa", "تأشيرة الإقامة"),
                  o("embassy", "Embassy", "سفارة"),
                  o("bank", "Bank", "بنك"),
                  o("university", "University application", "التقديم للجامعة"),
                  o("other", "Other", "غرض آخر"),
                ],
              },
              {
                id: "addressedTo",
                type: "short_text",
                label: t("Addressed to", "موجّهة إلى"),
                placeholder: t("For example, Embassy of Canada, Abu Dhabi", "مثال: سفارة كندا في أبوظبي"),
                required: true,
                showIf: { fieldId: "purpose", op: "in", value: ["embassy", "bank", "university"] },
              },
              { id: "copies", type: "number", label: t("Number of copies", "عدد النسخ"), required: true, min: 1, max: 5, width: "half" },
              { id: "neededBy", type: "date", label: t("Needed by", "مطلوبة بحلول"), required: true, width: "half" },
            ],
          },
          {
            id: "delivery_section",
            title: t("Delivery", "طريقة الاستلام"),
            fields: [
              {
                id: "deliveryMethod",
                type: "radio",
                label: t("How would you like to receive it?", "كيف تفضّل استلام الوثيقة؟"),
                required: true,
                options: [
                  o("collect", "Collect from reception", "الاستلام من الاستقبال"),
                  o("email", "Scanned copy by email", "نسخة إلكترونية عبر البريد الإلكتروني"),
                ],
              },
              {
                id: "deliveryEmail",
                type: "email",
                label: t("Email address", "البريد الإلكتروني"),
                prefill: "requester.email",
                required: true,
                showIf: { fieldId: "deliveryMethod", op: "eq", value: "email" },
              },
            ],
          },
        ],
      },
    ],
    t("Submit request", "إرسال الطلب"),
  ),

  form(
    "counselor_meeting",
    "meetings",
    t("Meet the school counselor", "لقاء المرشد الطلابي"),
    t("Everything you share with the counselor is kept private.", "كل ما تشاركه مع المرشد الطلابي يبقى في إطار السرية."),
    [
      {
        id: "meeting",
        title: t("Your meeting", "موعدك"),
        sections: [
          { id: "student_details", fields: [studentName(), studentGrade()] },
          {
            id: "meeting_details",
            fields: [
              {
                id: "topic",
                type: "select",
                label: t("What would you like to talk about?", "عمّ تودّ أن تتحدث؟"),
                required: true,
                options: [
                  o("study_stress", "Study stress", "ضغط الدراسة"),
                  o("friendships", "Friendships", "الصداقات"),
                  o("family", "Family", "الأسرة"),
                  o("future_plans", "Future plans", "الخطط المستقبلية"),
                  o("other", "Something else", "أمر آخر"),
                ],
              },
              {
                id: "topicOther",
                type: "short_text",
                label: t("Tell us briefly, if you like", "أخبرنا باختصار إن أحببت"),
                showIf: { fieldId: "topic", op: "eq", value: "other" },
              },
              { id: "preferredDate", type: "date", label: t("Preferred date", "التاريخ المفضّل"), width: "half" },
              { id: "preferredTime", type: "time", label: t("Preferred time", "الوقت المفضّل"), width: "half" },
              {
                id: "format",
                type: "radio",
                label: t("How would you like to meet?", "كيف تفضّل أن يكون اللقاء؟"),
                options: [o("in_person", "In person", "حضوريًا"), o("online", "Online", "عن بُعد")],
              },
            ],
          },
        ],
      },
    ],
    t("Book meeting", "احجز الموعد"),
  ),

  form(
    "talk_to_someone",
    "wellbeing",
    t("I need to talk to someone", "أحتاج أن أتحدث مع أحد"),
    t("You do not have to explain everything here. We will reach out to you gently.", "لا داعي لأن تشرح كل شيء هنا، وسنتواصل معك بكل لطف."),
    [
      {
        id: "talk",
        title: t("Talk to someone", "تحدّث مع أحد"),
        sections: [
          {
            id: "talk_section",
            fields: [
              {
                id: "reassurance",
                type: "statement",
                label: t(
                  "Thank you for reaching out. Only the wellbeing team will see this request. We will only share information if we are worried about your safety, and we will always talk to you first.",
                  "شكرًا لأنك تواصلت معنا. لن يطّلع على هذا الطلب سوى فريق الرفاه والدعم النفسي، ولن نشارك أي معلومة إلا إذا كنا قلقين على سلامتك، وسنتحدث معك أولًا في كل الأحوال.",
                ),
              },
              {
                id: "who",
                type: "radio",
                label: t("Who would you like to talk to?", "مع من تودّ أن تتحدث؟"),
                required: true,
                options: [
                  o("counselor", "A school counselor", "المرشد الطلابي"),
                  o("wellbeing_lead", "The wellbeing lead", "مسؤول الرفاه النفسي"),
                  o("no_preference", "Anyone is fine", "لا يهمّني من يكون"),
                ],
              },
              {
                id: "howUrgent",
                type: "radio",
                label: t("When would you like to talk?", "متى تودّ أن تتحدث؟"),
                required: true,
                options: [
                  o("today", "Today, please", "اليوم إن أمكن"),
                  o("this_week", "This week", "خلال هذا الأسبوع"),
                  o("whenever", "Whenever someone is free", "في أي وقت مناسب"),
                ],
              },
              {
                id: "urgentNote",
                type: "statement",
                label: t(
                  "If you feel unsafe right now, please go to any teacher or the school clinic straight away. You will not be in trouble.",
                  "إذا كنت تشعر بأنك في خطر الآن، فتوجّه فورًا إلى أي معلم أو إلى عيادة المدرسة، ولن تتعرّض لأي لوم.",
                ),
                showIf: { fieldId: "howUrgent", op: "eq", value: "today" },
              },
              {
                id: "anythingElse",
                type: "long_text",
                label: t("Is there anything you would like us to know? (optional)", "هل هناك ما تودّ أن نعرفه؟ (اختياري)"),
                maxLength: 1000,
              },
            ],
          },
        ],
      },
    ],
    t("Send", "إرسال"),
  ),

  form(
    "absence_request",
    "attendance",
    t("Absence notification or request", "الإبلاغ عن غياب أو طلب إذن غياب"),
    t("Planned absences during term time need approval from the Principal.", "يحتاج الغياب المخطط له خلال العام الدراسي إلى موافقة مدير المدرسة."),
    [
      {
        id: "absence",
        title: t("Absence details", "بيانات الغياب"),
        sections: [
          { id: "student_details", fields: [studentName(), studentGrade()] },
          {
            id: "absence_section",
            fields: [
              {
                id: "absenceType",
                type: "radio",
                label: t("Reason for absence", "سبب الغياب"),
                required: true,
                options: [
                  o("illness", "Illness", "مرض"),
                  o("medical_appointment", "Medical appointment", "موعد طبي"),
                  o("family_event", "Family event", "مناسبة عائلية"),
                  o("travel", "Travel", "سفر"),
                  o("religious_observance", "Religious observance", "مناسبة دينية"),
                  o("other", "Other", "سبب آخر"),
                ],
              },
              { id: "startDate", type: "date", label: t("First day of absence", "أول يوم غياب"), required: true, width: "half" },
              { id: "endDate", type: "date", label: t("Last day of absence", "آخر يوم غياب"), required: true, width: "half" },
              {
                id: "details",
                type: "long_text",
                label: t("Additional details", "تفاصيل إضافية"),
                maxLength: 800,
              },
              {
                id: "medicalNote",
                type: "file",
                label: t("Medical certificate", "الشهادة الطبية"),
                help: t("A medical certificate is required for illness absences of more than two days.", "يلزم إرفاق شهادة طبية في حال الغياب المرضي لأكثر من يومين."),
                showIf: { fieldId: "absenceType", op: "in", value: ["illness", "medical_appointment"] },
              },
              {
                id: "declaration",
                type: "consent",
                label: t("I confirm that the information above is accurate.", "أؤكد أن المعلومات الواردة أعلاه صحيحة."),
                required: true,
              },
            ],
          },
        ],
      },
    ],
  ),

  form(
    "it_support",
    "technology",
    t("IT support request", "طلب دعم تقني"),
    t("Describe the problem and the IT team will get back to you.", "صف المشكلة وسيتواصل معك فريق الدعم التقني."),
    [
      {
        id: "issue",
        title: t("The problem", "المشكلة"),
        sections: [
          {
            id: "issue_section",
            fields: [
              requesterName(),
              {
                id: "issueType",
                type: "select",
                label: t("What kind of problem is it?", "ما نوع المشكلة؟"),
                required: true,
                options: [
                  o("device", "Laptop or tablet", "الحاسوب المحمول أو الجهاز اللوحي"),
                  o("account_login", "Account or password", "الحساب أو كلمة المرور"),
                  o("wifi", "Wi-Fi", "شبكة الإنترنت اللاسلكية"),
                  o("printing", "Printing", "الطباعة"),
                  o("software", "Software or app", "البرامج والتطبيقات"),
                  o("classroom_av", "Classroom screen or projector", "شاشة الصف أو جهاز العرض"),
                  o("other", "Other", "أخرى"),
                ],
              },
              {
                id: "deviceTag",
                type: "short_text",
                label: t("Device asset tag", "رقم الجهاز التعريفي"),
                help: t("You will find it on the sticker underneath the device.", "تجده على الملصق أسفل الجهاز."),
                showIf: { fieldId: "issueType", op: "eq", value: "device" },
              },
              { id: "location", type: "short_text", label: t("Room or location", "الغرفة أو الموقع"), width: "half" },
              {
                id: "description",
                type: "long_text",
                label: t("Describe what is happening", "صف ما يحدث"),
                required: true,
                maxLength: 1500,
              },
              { id: "urgency", type: "radio", label: t("How urgent is it?", "ما مدى الاستعجال؟"), options: URGENCY_OPTIONS },
              { id: "screenshot", type: "file", label: t("Screenshot or photo (optional)", "لقطة شاشة أو صورة (اختياري)") },
            ],
          },
        ],
      },
    ],
  ),

  form(
    "activity_registration",
    "campus_life",
    t("Activity and club registration", "التسجيل في الأنشطة والأندية"),
    t("Places are limited and confirmed in order of registration.", "المقاعد محدودة ويُؤكَّد التسجيل حسب أسبقية الطلب."),
    [
      {
        id: "choice",
        title: t("Your choice", "اختيارك"),
        sections: [
          { id: "student_details", fields: [studentName(), studentGrade()] },
          {
            id: "activity_section",
            fields: [
              {
                id: "activity",
                type: "select",
                label: t("First choice", "الخيار الأول"),
                required: true,
                options: ACTIVITY_OPTIONS,
                width: "half",
              },
              {
                id: "secondChoice",
                type: "select",
                label: t("Second choice", "الخيار الثاني"),
                options: ACTIVITY_OPTIONS,
                width: "half",
              },
            ],
          },
        ],
      },
      {
        id: "health_consent",
        title: t("Health and consent", "الصحة والموافقة"),
        sections: [
          {
            id: "health_section",
            fields: [
              {
                id: "medicalConsiderations",
                type: "yes_no",
                label: t("Are there any medical conditions the coach should know about?", "هل توجد حالة صحية ينبغي أن يعرفها المدرب؟"),
              },
              {
                id: "medicalDetails",
                type: "long_text",
                label: t("Please give details", "يرجى ذكر التفاصيل"),
                required: true,
                showIf: { fieldId: "medicalConsiderations", op: "eq", value: true },
              },
              {
                id: "commitment",
                type: "checkbox",
                label: t("I will attend every session or let the teacher know in advance.", "ألتزم بحضور جميع الجلسات أو إبلاغ المعلم مسبقًا عند التغيب."),
                required: true,
              },
              {
                id: "parentConsent",
                type: "consent",
                label: t("As parent or guardian, I give permission for my child to take part.", "بصفتي ولي الأمر، أوافق على مشاركة ابني أو ابنتي في هذا النشاط."),
                required: true,
              },
            ],
          },
        ],
      },
    ],
  ),

  form(
    "exam_access_arrangements",
    "academic",
    t("Exam access arrangements", "الترتيبات الخاصة بالامتحانات"),
    t(
      "Applications for external exams must be made well before the exam board deadline and usually need specialist evidence.",
      "يجب تقديم طلبات الامتحانات الخارجية قبل الموعد النهائي لهيئة الامتحانات بوقت كافٍ، وغالبًا ما تتطلب تقريرًا من مختص.",
    ),
    [
      {
        id: "arrangements",
        title: t("Arrangements", "الترتيبات المطلوبة"),
        sections: [
          { id: "student_details", fields: [studentName(), studentGrade()] },
          {
            id: "exam_section",
            fields: [
              {
                id: "examTypes",
                type: "multi_select",
                label: t("Which exams is this for?", "لأي امتحانات هذا الطلب؟"),
                required: true,
                options: [
                  o("internal", "School exams", "امتحانات المدرسة"),
                  o("igcse", "IGCSE", "الشهادة الدولية IGCSE"),
                  o("a_level", "A Level", "المستوى المتقدم A Level"),
                  o("emsat", "EmSAT", "امتحان الإمارات القياسي EmSAT"),
                ],
              },
              {
                id: "arrangementsRequested",
                type: "multi_select",
                label: t("Arrangements requested", "الترتيبات المطلوبة"),
                required: true,
                options: [
                  o("extra_time", "Extra time", "وقت إضافي"),
                  o("reader", "Reader", "قارئ"),
                  o("scribe", "Scribe", "كاتب"),
                  o("word_processor", "Word processor", "استخدام الحاسوب في الكتابة"),
                  o("separate_room", "Separate room", "قاعة منفصلة"),
                  o("rest_breaks", "Rest breaks", "فترات استراحة"),
                ],
              },
              {
                id: "reason",
                type: "long_text",
                label: t("Why are these arrangements needed?", "لماذا تحتاج إلى هذه الترتيبات؟"),
                required: true,
                maxLength: 1500,
              },
              {
                id: "hasReport",
                type: "yes_no",
                label: t("Do you have a specialist or medical report?", "هل لديك تقرير من مختص أو تقرير طبي؟"),
              },
              {
                id: "report",
                type: "file",
                label: t("Upload the report", "أرفق التقرير"),
                required: true,
                showIf: { fieldId: "hasReport", op: "eq", value: true },
              },
            ],
          },
        ],
      },
    ],
  ),

  form(
    "id_card_replacement",
    "campus_life",
    t("ID card replacement", "استبدال البطاقة المدرسية"),
    t("Your new card will be ready to collect from reception within three school days.", "ستكون بطاقتك الجديدة جاهزة للاستلام من الاستقبال خلال ثلاثة أيام دراسية."),
    [
      {
        id: "card",
        title: t("Replacement card", "البطاقة البديلة"),
        sections: [
          { id: "student_details", fields: [studentName(), studentGrade()] },
          {
            id: "card_section",
            fields: [
              {
                id: "reason",
                type: "radio",
                label: t("Why do you need a new card?", "لماذا تحتاج إلى بطاقة جديدة؟"),
                required: true,
                options: [
                  o("lost", "Lost", "فُقدت"),
                  o("damaged", "Damaged", "تلفت"),
                  o("stolen", "Stolen", "سُرقت"),
                  o("name_change", "Details need updating", "البيانات تحتاج إلى تحديث"),
                ],
              },
              { id: "details", type: "long_text", label: t("Details (optional)", "تفاصيل (اختياري)"), maxLength: 500 },
              {
                id: "feeAcknowledgement",
                type: "checkbox",
                label: t(
                  "I understand a replacement fee of AED 50 will be added to the school account.",
                  "أعلم أن رسوم الاستبدال البالغة 50 درهمًا ستُضاف إلى الحساب المدرسي.",
                ),
                required: true,
                showIf: { fieldId: "reason", op: "in", value: ["lost", "stolen"] },
              },
            ],
          },
        ],
      },
    ],
  ),

  form(
    "locker_request",
    "campus_life",
    t("Locker request", "طلب خزانة"),
    t("Request a locker or report a problem with yours.", "اطلب خزانة أو أبلغ عن مشكلة في خزانتك."),
    [
      {
        id: "locker",
        title: t("Locker", "الخزانة"),
        sections: [
          { id: "student_details", fields: [studentName(), studentGrade()] },
          {
            id: "locker_section",
            fields: [
              {
                id: "requestType",
                type: "radio",
                label: t("What do you need?", "ماذا تحتاج؟"),
                required: true,
                options: [
                  o("new_locker", "A new locker", "خزانة جديدة"),
                  o("broken_lock", "My lock is broken", "القفل معطّل"),
                  o("change_location", "Move to a different locker", "الانتقال إلى خزانة أخرى"),
                  o("forgotten_code", "I forgot my code", "نسيت الرمز"),
                ],
              },
              {
                id: "lockerNumber",
                type: "short_text",
                label: t("Current locker number", "رقم الخزانة الحالية"),
                required: true,
                width: "half",
                showIf: { fieldId: "requestType", op: "neq", value: "new_locker" },
              },
              {
                id: "preferredBlock",
                type: "select",
                label: t("Preferred area", "المكان المفضّل"),
                width: "half",
                options: [
                  o("block_a", "Block A (Secondary)", "المبنى أ (المرحلة الثانوية)"),
                  o("block_b", "Block B (Middle school)", "المبنى ب (المرحلة المتوسطة)"),
                  o("sports_hall", "Sports hall", "الصالة الرياضية"),
                ],
              },
              {
                id: "rulesAgreement",
                type: "checkbox",
                label: t(
                  "I will keep my locker tidy and will not store food or valuables in it.",
                  "ألتزم بالمحافظة على نظافة خزانتي وعدم ترك الطعام أو المقتنيات الثمينة فيها.",
                ),
                required: true,
              },
            ],
          },
        ],
      },
    ],
  ),

  form(
    "recommendation_letter",
    "careers",
    t("Recommendation letter request", "طلب رسالة توصية"),
    t("Please give your referee at least three weeks before the deadline.", "يرجى منح كاتب التوصية ثلاثة أسابيع على الأقل قبل الموعد النهائي."),
    [
      {
        id: "request",
        title: t("Request", "الطلب"),
        sections: [
          { id: "student_details", fields: [studentName(), studentGrade()] },
          {
            id: "letter_section",
            fields: [
              {
                id: "referee",
                type: "staff_picker",
                label: t("Who would you like to write the letter?", "من تودّ أن يكتب رسالة التوصية؟"),
                required: true,
              },
              {
                id: "purpose",
                type: "select",
                label: t("Purpose", "الغرض"),
                required: true,
                options: [
                  o("university", "University application", "التقديم للجامعة"),
                  o("scholarship", "Scholarship", "منحة دراسية"),
                  o("summer_program", "Summer programme", "برنامج صيفي"),
                  o("internship", "Internship", "تدريب عملي"),
                  o("other", "Other", "غرض آخر"),
                ],
              },
              { id: "deadline", type: "date", label: t("Deadline", "الموعد النهائي"), required: true, width: "half" },
            ],
          },
        ],
      },
      {
        id: "supporting",
        title: t("Supporting information", "معلومات داعمة"),
        sections: [
          {
            id: "supporting_section",
            fields: [
              {
                id: "institutions",
                type: "long_text",
                label: t("Universities or programmes", "الجامعات أو البرامج"),
                maxLength: 800,
              },
              {
                id: "achievements",
                type: "long_text",
                label: t("Achievements you would like mentioned", "إنجازات تودّ الإشارة إليها"),
                maxLength: 1500,
              },
              { id: "cvUpload", type: "file", label: t("CV or activity list (optional)", "السيرة الذاتية أو قائمة الأنشطة (اختياري)") },
            ],
          },
        ],
      },
    ],
  ),

  form(
    "learning_support",
    "academic",
    t("Learning support request", "طلب دعم التعلّم"),
    t("The inclusion team will review the request and contact you to arrange next steps.", "سيراجع فريق الدمج التعليمي الطلب ويتواصل معكم لترتيب الخطوات التالية."),
    [
      {
        id: "needs",
        title: t("Learning needs", "احتياجات التعلّم"),
        sections: [
          { id: "people", fields: [requesterName(), studentName(), studentGrade()] },
          {
            id: "needs_section",
            fields: [
              {
                id: "areas",
                type: "multi_select",
                label: t("Areas of difficulty", "جوانب الصعوبة"),
                required: true,
                options: [
                  o("reading", "Reading", "القراءة"),
                  o("writing", "Writing", "الكتابة"),
                  o("maths", "Mathematics", "الرياضيات"),
                  o("attention", "Attention and focus", "الانتباه والتركيز"),
                  o("organisation", "Organisation", "التنظيم"),
                  o("memory", "Memory", "الذاكرة"),
                  o("social_communication", "Social communication", "التواصل الاجتماعي"),
                  o("sensory", "Sensory needs", "الاحتياجات الحسية"),
                ],
              },
              {
                id: "details",
                type: "long_text",
                label: t("What have you noticed?", "ما الذي لاحظته؟"),
                required: true,
                maxLength: 2000,
              },
              {
                id: "previousAssessment",
                type: "yes_no",
                label: t("Has there been a previous assessment or diagnosis?", "هل سبق إجراء تقييم أو تشخيص؟"),
              },
              {
                id: "assessmentReport",
                type: "file",
                label: t("Upload the assessment report", "أرفق تقرير التقييم"),
                showIf: { fieldId: "previousAssessment", op: "eq", value: true },
              },
              {
                id: "consent",
                type: "consent",
                label: t(
                  "I agree that the inclusion team may observe and assess the student and share findings with relevant teachers.",
                  "أوافق على أن يقوم فريق الدمج التعليمي بملاحظة الطالب وتقييمه ومشاركة النتائج مع المعلمين المعنيين.",
                ),
                required: true,
              },
            ],
          },
        ],
      },
    ],
  ),

  form(
    "feedback",
    "feedback",
    t("Share feedback", "شاركنا رأيك"),
    t("We read every message. Thank you for helping us improve.", "نقرأ كل رسالة تصلنا. شكرًا لمساعدتك لنا على التطوير."),
    [
      {
        id: "feedback_step",
        title: t("Your feedback", "رأيك"),
        sections: [
          {
            id: "feedback_section",
            fields: [
              requesterName(),
              {
                id: "feedbackType",
                type: "radio",
                label: t("Type of feedback", "نوع الملاحظة"),
                required: true,
                options: [
                  o("compliment", "Compliment", "إشادة"),
                  o("suggestion", "Suggestion", "اقتراح"),
                  o("concern", "Concern", "ملاحظة أو شكوى"),
                ],
              },
              {
                id: "area",
                type: "select",
                label: t("What is it about?", "بم تتعلق؟"),
                options: [
                  o("teaching", "Teaching and learning", "التعليم والتعلّم"),
                  o("facilities", "Facilities", "المرافق"),
                  o("transport", "Transport", "المواصلات"),
                  o("canteen", "Canteen", "المقصف"),
                  o("communication", "Communication", "التواصل"),
                  o("activities", "Activities and events", "الأنشطة والفعاليات"),
                  o("other", "Other", "أخرى"),
                ],
              },
              {
                id: "message",
                type: "long_text",
                label: t("Your message", "رسالتك"),
                required: true,
                maxLength: 2000,
              },
              {
                id: "overallRating",
                type: "rating",
                label: t("Overall, how happy are you with the school?", "بشكل عام، ما مدى رضاك عن المدرسة؟"),
                min: 1,
                max: 5,
              },
              {
                id: "contactMe",
                type: "yes_no",
                label: t("Would you like us to contact you about this?", "هل تودّ أن نتواصل معك بشأن ذلك؟"),
              },
              {
                id: "contactEmail",
                type: "email",
                label: t("Email address", "البريد الإلكتروني"),
                prefill: "requester.email",
                required: true,
                showIf: { fieldId: "contactMe", op: "eq", value: true },
              },
            ],
          },
        ],
      },
    ],
    t("Send feedback", "إرسال الملاحظة"),
  ),

  // ───────────────────────── Parent services ─────────────────────────
  form(
    "parent_meeting",
    "meetings",
    t("Parent meeting request", "طلب اجتماع ولي الأمر"),
    t("Choose who you would like to meet and we will confirm a time with you.", "اختر من تودّ لقاءه وسنؤكد معك الموعد."),
    [
      {
        id: "meeting",
        title: t("Meeting details", "تفاصيل الاجتماع"),
        sections: [
          {
            id: "who_section",
            fields: [
              requesterName(),
              studentPicker(),
              {
                id: "withWhom",
                type: "staff_picker",
                label: t("Who would you like to meet?", "من تودّ أن تقابل؟"),
                help: t("A teacher, Head of Year or counselor.", "المعلم أو رئيس المرحلة أو المرشد الطلابي."),
              },
              {
                id: "topic",
                type: "select",
                label: t("Topic", "موضوع الاجتماع"),
                required: true,
                options: [
                  o("progress", "Academic progress", "التقدّم الدراسي"),
                  o("behaviour", "Behaviour", "السلوك"),
                  o("wellbeing", "Wellbeing", "الرفاه النفسي"),
                  o("subject_choice", "Subject choices", "اختيار المواد"),
                  o("other", "Other", "موضوع آخر"),
                ],
              },
              {
                id: "details",
                type: "long_text",
                label: t("What would you like to discuss?", "ما الذي تودّ مناقشته؟"),
                required: true,
                maxLength: 1500,
              },
            ],
          },
          {
            id: "when_section",
            title: t("When and how", "الموعد وطريقة اللقاء"),
            fields: [
              {
                id: "attendance",
                type: "radio",
                label: t("How would you like to meet?", "كيف تفضّل أن يكون الاجتماع؟"),
                required: true,
                options: [o("in_person", "In person at school", "حضوريًا في المدرسة"), o("online", "Online", "عن بُعد")],
              },
              {
                id: "onlineNote",
                type: "statement",
                label: t("We will email you a Microsoft Teams link before the meeting.", "سنرسل إليك رابط الاجتماع عبر Microsoft Teams بالبريد الإلكتروني قبل الموعد."),
                showIf: { fieldId: "attendance", op: "eq", value: "online" },
              },
              { id: "preferredDate", type: "date", label: t("Preferred date", "التاريخ المفضّل"), width: "half" },
              { id: "preferredTime", type: "time", label: t("Preferred time", "الوقت المفضّل"), width: "half" },
            ],
          },
        ],
      },
    ],
    t("Request meeting", "اطلب الاجتماع"),
  ),

  form(
    "transport_request",
    "campus_life",
    t("School bus request", "طلب الحافلة المدرسية"),
    t("Route changes take effect within five school days once confirmed.", "تُطبَّق التعديلات على خط السير خلال خمسة أيام دراسية من تأكيدها."),
    [
      {
        id: "transport",
        title: t("Bus service", "خدمة الحافلة"),
        sections: [
          { id: "student_details", fields: [studentName(), studentGrade()] },
          {
            id: "transport_section",
            fields: [
              {
                id: "requestType",
                type: "radio",
                label: t("What would you like to do?", "ما الذي تودّ القيام به؟"),
                required: true,
                options: [
                  o("new_registration", "Register for the bus", "التسجيل في الحافلة"),
                  o("change_stop", "Change pickup or drop off point", "تغيير نقطة الصعود أو النزول"),
                  o("cancel", "Cancel the service", "إلغاء الاشتراك"),
                ],
              },
              {
                id: "area",
                type: "select",
                label: t("Area", "المنطقة"),
                showIf: { fieldId: "requestType", op: "in", value: ["new_registration", "change_stop"] },
                options: [
                  o("al_barsha", "Al Barsha", "البرشاء"),
                  o("jumeirah", "Jumeirah", "جميرا"),
                  o("dubai_marina", "Dubai Marina", "دبي مارينا"),
                  o("jlt", "Jumeirah Lake Towers", "أبراج بحيرات جميرا"),
                  o("arabian_ranches", "Arabian Ranches", "المرابع العربية"),
                  o("mirdif", "Mirdif", "مردف"),
                  o("downtown", "Downtown Dubai", "وسط مدينة دبي"),
                  o("other", "Other", "منطقة أخرى"),
                ],
              },
              {
                id: "pickupAddress",
                type: "long_text",
                label: t("Full address and nearest landmark", "العنوان بالتفصيل وأقرب معلم"),
                required: true,
                showIf: { fieldId: "requestType", op: "in", value: ["new_registration", "change_stop"] },
              },
              {
                id: "tripType",
                type: "radio",
                label: t("Trips needed", "الرحلات المطلوبة"),
                showIf: { fieldId: "requestType", op: "neq", value: "cancel" },
                options: [
                  o("both_ways", "Both ways", "ذهابًا وإيابًا"),
                  o("morning_only", "Morning only", "الصباح فقط"),
                  o("afternoon_only", "Afternoon only", "بعد الظهر فقط"),
                ],
              },
              { id: "startDate", type: "date", label: t("Starting from", "اعتبارًا من"), required: true, width: "half" },
              {
                id: "contactPhone",
                type: "phone",
                label: t("Mobile number for the bus supervisor", "رقم الهاتف المتحرك لمشرف الحافلة"),
                prefill: "requester.phone",
                required: true,
                width: "half",
              },
            ],
          },
        ],
      },
    ],
  ),

  form(
    "contact_update",
    "campus_life",
    t("Update contact details", "تحديث بيانات التواصل"),
    t("Accurate details help us reach you quickly in an emergency.", "تساعدنا البيانات الدقيقة على التواصل معكم بسرعة في حالات الطوارئ."),
    [
      {
        id: "changes",
        title: t("What has changed?", "ما الذي تغيّر؟"),
        sections: [
          {
            id: "changes_section",
            fields: [
              requesterName(),
              studentName(),
              {
                id: "whatChanged",
                type: "multi_select",
                label: t("Select everything that has changed", "اختر كل ما تغيّر"),
                required: true,
                options: [
                  o("mobile", "Mobile number", "رقم الهاتف المتحرك"),
                  o("email", "Email address", "البريد الإلكتروني"),
                  o("home_address", "Home address", "عنوان السكن"),
                  o("emergency_contact", "Emergency contact", "جهة الاتصال في حالات الطوارئ"),
                ],
              },
            ],
          },
        ],
      },
      {
        id: "new_details",
        title: t("New details", "البيانات الجديدة"),
        sections: [
          {
            id: "new_details_section",
            fields: [
              {
                id: "newMobile",
                type: "phone",
                label: t("New mobile number", "رقم الهاتف المتحرك الجديد"),
                placeholder: t("+971 5X XXX XXXX", "+971 5X XXX XXXX"),
                required: true,
                showIf: { fieldId: "whatChanged", op: "contains", value: "mobile" },
              },
              {
                id: "newEmail",
                type: "email",
                label: t("New email address", "البريد الإلكتروني الجديد"),
                required: true,
                showIf: { fieldId: "whatChanged", op: "contains", value: "email" },
              },
              {
                id: "newAddress",
                type: "long_text",
                label: t("New home address", "عنوان السكن الجديد"),
                required: true,
                showIf: { fieldId: "whatChanged", op: "contains", value: "home_address" },
              },
              {
                id: "emergencyName",
                type: "short_text",
                label: t("Emergency contact name and relationship", "اسم جهة الاتصال في حالات الطوارئ وصلة القرابة"),
                required: true,
                showIf: { fieldId: "whatChanged", op: "contains", value: "emergency_contact" },
              },
              {
                id: "emergencyPhone",
                type: "phone",
                label: t("Emergency contact number", "رقم جهة الاتصال في حالات الطوارئ"),
                required: true,
                showIf: { fieldId: "whatChanged", op: "contains", value: "emergency_contact" },
              },
              {
                id: "declaration",
                type: "consent",
                label: t("I confirm these details are correct.", "أؤكد صحة هذه البيانات."),
                required: true,
              },
            ],
          },
        ],
      },
    ],
  ),

  form(
    "early_pickup",
    "attendance",
    t("Early pickup request", "طلب استلام مبكر"),
    t("Please submit at least two hours before pickup where possible.", "يرجى تقديم الطلب قبل موعد الاستلام بساعتين على الأقل كلما أمكن."),
    [
      {
        id: "pickup",
        title: t("Pickup details", "تفاصيل الاستلام"),
        sections: [
          { id: "student_details", fields: [studentName(), studentGrade()] },
          {
            id: "pickup_section",
            fields: [
              { id: "pickupDate", type: "date", label: t("Date", "التاريخ"), prefill: "today", required: true, width: "half" },
              { id: "pickupTime", type: "time", label: t("Pickup time", "وقت الاستلام"), required: true, width: "half" },
              {
                id: "reason",
                type: "select",
                label: t("Reason", "السبب"),
                required: true,
                options: [
                  o("medical_appointment", "Medical appointment", "موعد طبي"),
                  o("family_matter", "Family matter", "ظرف عائلي"),
                  o("travel", "Travel", "سفر"),
                  o("other", "Other", "سبب آخر"),
                ],
              },
              {
                id: "collector",
                type: "radio",
                label: t("Who will collect the student?", "من سيستلم الطالب؟"),
                required: true,
                options: [
                  o("me", "I will", "أنا"),
                  o("other_guardian", "The other parent or guardian", "ولي الأمر الآخر"),
                  o("authorised_person", "Another authorised adult", "شخص بالغ آخر مفوَّض"),
                ],
              },
              {
                id: "collectorName",
                type: "short_text",
                label: t("Full name of the person collecting", "الاسم الكامل للشخص المستلِم"),
                required: true,
                showIf: { fieldId: "collector", op: "eq", value: "authorised_person" },
              },
              {
                id: "collectorEmiratesId",
                type: "short_text",
                label: t("Their Emirates ID number", "رقم الهوية الإماراتية للشخص المستلِم"),
                placeholder: t("784-XXXX-XXXXXXX-X", "784-XXXX-XXXXXXX-X"),
                required: true,
                showIf: { fieldId: "collector", op: "eq", value: "authorised_person" },
              },
              {
                id: "idNotice",
                type: "statement",
                label: t(
                  "For your child's safety, students are only released to adults who show a valid Emirates ID at reception.",
                  "حرصًا على سلامة أبنائنا، لا يُسلَّم الطالب إلا لشخص بالغ يبرز هوية إماراتية سارية في الاستقبال.",
                ),
              },
            ],
          },
        ],
      },
    ],
  ),

  form(
    "medical_update",
    "wellbeing",
    t("Medical information update", "تحديث المعلومات الطبية"),
    t("This information is seen only by the school nurse and staff who need it to keep your child safe.", "لا يطّلع على هذه المعلومات إلا ممرضة المدرسة والموظفون الذين يحتاجون إليها للحفاظ على سلامة طفلكم."),
    [
      {
        id: "medical",
        title: t("Medical update", "التحديث الطبي"),
        sections: [
          { id: "student_details", fields: [studentName(), studentGrade()] },
          {
            id: "medical_section",
            fields: [
              {
                id: "updateType",
                type: "multi_select",
                label: t("What is the update about?", "بم يتعلق التحديث؟"),
                required: true,
                options: [
                  o("new_diagnosis", "New diagnosis", "تشخيص جديد"),
                  o("allergy", "Allergy", "حساسية"),
                  o("medication", "Medication", "أدوية"),
                  o("dietary", "Dietary needs", "احتياجات غذائية"),
                  o("injury", "Injury", "إصابة"),
                  o("other", "Other", "أخرى"),
                ],
              },
              {
                id: "details",
                type: "long_text",
                label: t("Please describe the update", "يرجى وصف التحديث"),
                required: true,
                maxLength: 2000,
              },
              {
                id: "medicationDetails",
                type: "long_text",
                label: t("Medication name, dose and times", "اسم الدواء والجرعة والمواعيد"),
                required: true,
                showIf: { fieldId: "updateType", op: "contains", value: "medication" },
              },
              {
                id: "medicationInSchool",
                type: "yes_no",
                label: t("Does the medication need to be given during school hours?", "هل يلزم إعطاء الدواء خلال اليوم الدراسي؟"),
                showIf: { fieldId: "updateType", op: "contains", value: "medication" },
              },
              { id: "report", type: "file", label: t("Doctor's report or prescription", "تقرير الطبيب أو الوصفة الطبية") },
              {
                id: "consent",
                type: "consent",
                label: t(
                  "I agree that the nurse may share this information with staff who care for my child.",
                  "أوافق على أن تشارك الممرضة هذه المعلومات مع الموظفين المعنيين برعاية طفلي.",
                ),
                required: true,
              },
            ],
          },
        ],
      },
    ],
  ),

  // ───────────────────────── Staff services ─────────────────────────
  form(
    "academic_concern",
    "academic",
    t("Academic concern referral", "إحالة ملاحظة أكاديمية"),
    t("Share what you have seen so the Head of Department and advisor can plan support.", "شارك ما لاحظته ليتمكن رئيس القسم والمرشد الأكاديمي من التخطيط للدعم المناسب."),
    [
      {
        id: "concern",
        title: t("The concern", "الملاحظة"),
        sections: [
          {
            id: "student_subject",
            fields: [studentPicker(), { id: "subject", type: "subject_picker", label: t("Subject", "المادة"), required: true }],
          },
          {
            id: "concern_details",
            title: t("What have you observed?", "ما الذي لاحظته؟"),
            fields: [
              {
                id: "concernAreas",
                type: "multi_select",
                label: t("Areas of concern", "جوانب الملاحظة"),
                required: true,
                options: [
                  o("grades_declining", "Grades declining", "تراجع الدرجات"),
                  o("missing_homework", "Missing homework", "عدم تسليم الواجبات"),
                  o("low_participation", "Low participation", "ضعف المشاركة"),
                  o("attendance", "Attendance", "الحضور"),
                  o("understanding_gaps", "Gaps in understanding", "فجوات في الفهم"),
                  o("exam_anxiety", "Exam anxiety", "قلق الامتحانات"),
                ],
              },
              {
                id: "observations",
                type: "long_text",
                label: t("Observations", "الملاحظات"),
                help: t("Include recent assessment results where relevant.", "أدرج نتائج التقييمات الأخيرة عند الحاجة."),
                required: true,
                maxLength: 3000,
              },
              {
                id: "actionsTaken",
                type: "long_text",
                label: t("Actions already taken", "الإجراءات المتخذة حتى الآن"),
                maxLength: 2000,
              },
            ],
          },
        ],
      },
      {
        id: "follow_up",
        title: t("Follow up", "المتابعة"),
        sections: [
          {
            id: "follow_up_section",
            fields: [
              { id: "urgency", type: "radio", label: t("Urgency", "درجة الاستعجال"), required: true, options: URGENCY_OPTIONS },
              { id: "parentContacted", type: "yes_no", label: t("Have you contacted the parent?", "هل تواصلت مع ولي الأمر؟") },
              {
                id: "parentContactDate",
                type: "date",
                label: t("Date of contact", "تاريخ التواصل"),
                showIf: { fieldId: "parentContacted", op: "eq", value: true },
              },
            ],
          },
        ],
      },
    ],
    t("Submit referral", "إرسال الإحالة"),
  ),

  form(
    "behavioral_referral",
    "wellbeing",
    t("Behaviour referral", "إحالة سلوكية"),
    t("Record the facts of the incident. The Head of Year will review and follow up.", "سجّل وقائع الموقف كما حدثت، وسيراجعها رئيس المرحلة ويتابعها."),
    [
      {
        id: "incident",
        title: t("Incident", "الموقف"),
        sections: [
          {
            id: "incident_section",
            fields: [
              studentPicker(),
              { id: "incidentDate", type: "date", label: t("Date", "التاريخ"), prefill: "today", required: true, width: "half" },
              { id: "incidentTime", type: "time", label: t("Time", "الوقت"), width: "half" },
              {
                id: "location",
                type: "select",
                label: t("Location", "المكان"),
                options: [
                  o("classroom", "Classroom", "الصف"),
                  o("corridor", "Corridor", "الممر"),
                  o("playground", "Playground", "الساحة"),
                  o("canteen", "Canteen", "المقصف"),
                  o("bus", "School bus", "الحافلة المدرسية"),
                  o("online", "Online", "عبر الإنترنت"),
                  o("other", "Other", "مكان آخر"),
                ],
              },
              {
                id: "behaviourType",
                type: "multi_select",
                label: t("Type of behaviour", "نوع السلوك"),
                required: true,
                options: [
                  o("disruption", "Disrupting learning", "الإخلال بسير التعلّم"),
                  o("defiance", "Refusing instructions", "رفض التعليمات"),
                  o("bullying", "Bullying", "التنمّر"),
                  o("physical_aggression", "Physical aggression", "الاعتداء الجسدي"),
                  o("verbal_abuse", "Verbal abuse", "الإساءة اللفظية"),
                  o("damage_to_property", "Damage to property", "إتلاف الممتلكات"),
                  o("truancy", "Truancy", "التغيّب دون إذن"),
                  o("device_misuse", "Misuse of devices", "سوء استخدام الأجهزة"),
                ],
              },
            ],
          },
        ],
      },
      {
        id: "detail",
        title: t("Details and actions", "التفاصيل والإجراءات"),
        sections: [
          {
            id: "detail_section",
            fields: [
              {
                id: "description",
                type: "long_text",
                label: t("What happened?", "ماذا حدث؟"),
                required: true,
                maxLength: 3000,
              },
              {
                id: "severity",
                type: "radio",
                label: t("Severity", "درجة الخطورة"),
                required: true,
                options: [o("minor", "Minor", "بسيطة"), o("moderate", "Moderate", "متوسطة"), o("serious", "Serious", "جسيمة")],
              },
              { id: "witnesses", type: "staff_picker", label: t("Staff witness (optional)", "شاهد من الموظفين (اختياري)") },
              { id: "immediateAction", type: "long_text", label: t("Immediate action taken", "الإجراء الفوري المتخذ"), maxLength: 1500 },
              { id: "parentContacted", type: "yes_no", label: t("Has the parent been informed?", "هل أُبلغ ولي الأمر؟") },
            ],
          },
        ],
      },
    ],
  ),

  form(
    "wellbeing_referral",
    "wellbeing",
    t("Wellbeing referral", "إحالة الرفاه النفسي"),
    t("Refer a student you are worried about. The wellbeing team will check in with them.", "أحِل الطالب الذي يقلقك وضعه، وسيتواصل معه فريق الرفاه النفسي."),
    [
      {
        id: "referral",
        title: t("Referral", "الإحالة"),
        sections: [
          {
            id: "safeguarding_reminder",
            fields: [
              {
                id: "safeguardingReminder",
                type: "statement",
                label: t(
                  "If you think a child may be at risk of harm, stop and use the safeguarding concern form instead.",
                  "إذا كنت تعتقد أن الطفل قد يكون معرّضًا للأذى، فتوقّف واستخدم نموذج الإبلاغ عن مخاوف حماية الطفل بدلًا من هذا النموذج.",
                ),
              },
            ],
          },
          {
            id: "referral_section",
            fields: [
              studentPicker(),
              {
                id: "observedChanges",
                type: "multi_select",
                label: t("What have you noticed?", "ما الذي لاحظته؟"),
                required: true,
                options: [
                  o("withdrawn", "Withdrawn or quiet", "انطواء أو هدوء غير معتاد"),
                  o("tearful", "Tearful", "بكاء متكرر"),
                  o("low_mood", "Low mood", "مزاج منخفض"),
                  o("anxiety", "Anxiety or worry", "قلق أو توتر"),
                  o("friendship_issues", "Friendship difficulties", "صعوبات في الصداقات"),
                  o("changes_in_eating", "Changes in eating", "تغيّر في عادات الأكل"),
                  o("tiredness", "Tiredness", "إرهاق"),
                  o("self_criticism", "Harsh self criticism", "قسوة في انتقاد الذات"),
                ],
              },
              {
                id: "concernLevel",
                type: "scale",
                label: t("How worried are you?", "ما مدى قلقك؟"),
                help: t("1 is slightly worried, 10 is very worried.", "الرقم 1 يعني قلقًا بسيطًا، والرقم 10 يعني قلقًا شديدًا."),
                min: 1,
                max: 10,
                required: true,
              },
              {
                id: "details",
                type: "long_text",
                label: t("Details", "التفاصيل"),
                required: true,
                maxLength: 3000,
              },
              {
                id: "studentAware",
                type: "yes_no",
                label: t("Has the student spoken to you about this?", "هل تحدّث إليك الطالب بشأن ذلك؟"),
              },
              {
                id: "studentWords",
                type: "long_text",
                label: t("What did they say?", "ماذا قال؟"),
                showIf: { fieldId: "studentAware", op: "eq", value: true },
              },
            ],
          },
        ],
      },
    ],
  ),

  form(
    "safeguarding_concern",
    "safeguarding",
    t("Safeguarding concern", "الإبلاغ عن مخاوف تتعلق بحماية الطفل"),
    t(
      "This report goes directly to the Designated Safeguarding Lead and is strictly confidential.",
      "يصل هذا البلاغ مباشرة إلى المسؤول المعيّن لحماية الطفل ويُعامَل بسرية تامة.",
    ),
    [
      {
        id: "urgency",
        title: t("Urgency", "درجة الخطورة"),
        sections: [
          {
            id: "urgency_section",
            fields: [
              studentPicker(),
              {
                id: "level",
                type: "radio",
                label: t("How serious is the concern?", "ما مدى خطورة الوضع؟"),
                required: true,
                options: [
                  o("LOW", "Low", "منخفضة"),
                  o("MEDIUM", "Medium", "متوسطة"),
                  o("HIGH", "High", "عالية"),
                  o("IMMEDIATE_DANGER", "Immediate danger", "خطر فوري"),
                ],
              },
              {
                id: "emergencyNotice",
                type: "statement",
                label: t(
                  "Stay with the child and call the Designated Safeguarding Lead now. Do not wait until you finish this form.",
                  "ابقَ مع الطفل واتصل بالمسؤول المعيّن لحماية الطفل فورًا، ولا تنتظر حتى تُكمل هذا النموذج.",
                ),
                showIf: { fieldId: "level", op: "eq", value: "IMMEDIATE_DANGER" },
              },
            ],
          },
        ],
      },
      {
        id: "what_happened",
        title: t("What happened", "ما الذي حدث"),
        sections: [
          {
            id: "facts_section",
            fields: [
              {
                id: "whatHappened",
                type: "long_text",
                label: t("Describe your concern", "صف ما يقلقك"),
                help: t(
                  "Record the facts and the child's own words. Do not investigate or ask leading questions.",
                  "دوّن الوقائع وكلمات الطفل كما قالها. لا تحقق في الأمر ولا تطرح أسئلة إيحائية.",
                ),
                required: true,
                maxLength: 5000,
              },
              { id: "when", type: "date", label: t("When did it happen or when were you told?", "متى حدث ذلك أو متى أُبلغت به؟"), width: "half" },
              { id: "where", type: "short_text", label: t("Where?", "أين؟"), width: "half" },
              {
                id: "childWords",
                type: "long_text",
                label: t("The child's exact words, if they spoke to you", "كلمات الطفل كما قالها، إن تحدّث إليك"),
                maxLength: 3000,
              },
            ],
          },
        ],
      },
      {
        id: "next_steps",
        title: t("Next steps", "الخطوات التالية"),
        sections: [
          {
            id: "informed_section",
            fields: [
              {
                id: "othersInformed",
                type: "multi_select",
                label: t("Who else have you told?", "من أبلغت غير ذلك؟"),
                options: [
                  o("dsl", "Designated Safeguarding Lead", "المسؤول المعيّن لحماية الطفل"),
                  o("deputy_dsl", "Deputy Safeguarding Lead", "نائب المسؤول عن حماية الطفل"),
                  o("head_of_year", "Head of Year", "رئيس المرحلة"),
                  o("principal", "Principal", "مدير المدرسة"),
                  o("nurse", "School nurse", "ممرضة المدرسة"),
                  o("counselor", "Counselor", "المرشد الطلابي"),
                  o("no_one", "No one yet", "لم أبلغ أحدًا بعد"),
                ],
              },
              requesterName(),
              {
                id: "declaration",
                type: "consent",
                label: t(
                  "I confirm this is an accurate record and I will not discuss it with anyone other than the safeguarding team.",
                  "أؤكد أن هذا سجل دقيق، وألتزم بعدم مناقشته مع أي شخص من خارج فريق حماية الطفل.",
                ),
                required: true,
              },
            ],
          },
        ],
      },
    ],
    t("Submit to the safeguarding team", "إرسال إلى فريق حماية الطفل"),
  ),

  form(
    "learning_support_referral",
    "academic",
    t("Learning support referral", "إحالة دعم التعلّم"),
    t("Refer a student for assessment by the inclusion team.", "أحِل الطالب إلى فريق الدمج التعليمي لتقييمه."),
    [
      {
        id: "referral",
        title: t("Referral", "الإحالة"),
        sections: [
          {
            id: "referral_section",
            fields: [
              studentPicker(),
              { id: "subject", type: "subject_picker", label: t("Subject where needs are most visible", "المادة التي تظهر فيها الاحتياجات بوضوح") },
              {
                id: "areas",
                type: "multi_select",
                label: t("Areas of need", "جوانب الاحتياج"),
                required: true,
                options: [
                  o("reading", "Reading", "القراءة"),
                  o("writing", "Writing", "الكتابة"),
                  o("maths", "Mathematics", "الرياضيات"),
                  o("attention", "Attention and focus", "الانتباه والتركيز"),
                  o("processing_speed", "Processing speed", "سرعة المعالجة"),
                  o("social_communication", "Social communication", "التواصل الاجتماعي"),
                ],
              },
              {
                id: "evidence",
                type: "long_text",
                label: t("Evidence and observations", "الشواهد والملاحظات"),
                required: true,
                maxLength: 3000,
              },
              {
                id: "strategiesTried",
                type: "long_text",
                label: t("Classroom strategies already tried", "الاستراتيجيات الصفية التي جُرّبت"),
                maxLength: 2000,
              },
              { id: "workSample", type: "file", label: t("Work sample (optional)", "نموذج من أعمال الطالب (اختياري)") },
              { id: "parentInformed", type: "yes_no", label: t("Is the parent aware of this referral?", "هل ولي الأمر على علم بهذه الإحالة؟") },
            ],
          },
        ],
      },
    ],
  ),

  form(
    "field_trip_approval",
    "staff_operations",
    t("Field trip approval", "اعتماد رحلة مدرسية"),
    t("Submit at least four weeks before the trip. A risk assessment is required.", "قدّم الطلب قبل موعد الرحلة بأربعة أسابيع على الأقل، مع إرفاق تقييم المخاطر."),
    [
      {
        id: "trip",
        title: t("Trip details", "تفاصيل الرحلة"),
        sections: [
          {
            id: "trip_section",
            fields: [
              { id: "tripTitle", type: "short_text", label: t("Trip title", "عنوان الرحلة"), required: true },
              {
                id: "destination",
                type: "short_text",
                label: t("Destination", "الوجهة"),
                placeholder: t("For example, Museum of the Future", "مثال: متحف المستقبل"),
                required: true,
              },
              { id: "tripDate", type: "date", label: t("Date", "التاريخ"), required: true },
              { id: "departureTime", type: "time", label: t("Departure", "وقت المغادرة"), required: true, width: "half" },
              { id: "returnTime", type: "time", label: t("Return", "وقت العودة"), required: true, width: "half" },
            ],
          },
        ],
      },
      {
        id: "logistics",
        title: t("Students, staff and cost", "الطلبة والمشرفون والتكلفة"),
        sections: [
          {
            id: "logistics_section",
            fields: [
              { id: "studentCount", type: "number", label: t("Number of students", "عدد الطلبة"), required: true, min: 1, max: 300, width: "half" },
              {
                id: "costPerStudent",
                type: "number",
                label: t("Cost per student (AED)", "التكلفة لكل طالب (بالدرهم)"),
                min: 0,
                max: 5000,
                width: "half",
              },
              { id: "supervisingStaff", type: "staff_picker", label: t("Supervising staff", "المشرفون المرافقون"), required: true },
              { id: "riskAssessment", type: "file", label: t("Risk assessment", "تقييم المخاطر"), required: true },
              { id: "signature", type: "signature", label: t("Trip leader signature", "توقيع قائد الرحلة"), required: true },
            ],
          },
        ],
      },
    ],
  ),

  form(
    "pd_request",
    "staff_operations",
    t("Professional development request", "طلب تطوير مهني"),
    t("Requests are reviewed against the school improvement plan and the PD budget.", "تُراجَع الطلبات في ضوء خطة تطوير المدرسة وميزانية التطوير المهني."),
    [
      {
        id: "course",
        title: t("Course", "الدورة"),
        sections: [
          {
            id: "course_section",
            fields: [
              requesterName(),
              { id: "courseTitle", type: "short_text", label: t("Course or event title", "عنوان الدورة أو الفعالية"), required: true },
              { id: "provider", type: "short_text", label: t("Provider", "الجهة المنظّمة"), width: "half" },
              { id: "startDate", type: "date", label: t("Start date", "تاريخ البدء"), required: true, width: "half" },
              { id: "endDate", type: "date", label: t("End date", "تاريخ الانتهاء"), width: "half" },
              {
                id: "format",
                type: "radio",
                label: t("Format", "طريقة الحضور"),
                options: [o("in_person", "In person", "حضوري"), o("online", "Online", "عن بُعد"), o("hybrid", "Hybrid", "مدمج")],
              },
            ],
          },
        ],
      },
      {
        id: "support",
        title: t("Funding and impact", "التمويل والأثر"),
        sections: [
          {
            id: "support_section",
            fields: [
              { id: "fundingNeeded", type: "yes_no", label: t("Do you need school funding?", "هل تحتاج إلى تمويل من المدرسة؟") },
              {
                id: "cost",
                type: "number",
                label: t("Total cost (AED)", "التكلفة الإجمالية (بالدرهم)"),
                required: true,
                min: 0,
                max: 50000,
                showIf: { fieldId: "fundingNeeded", op: "eq", value: true },
              },
              { id: "coverNeeded", type: "yes_no", label: t("Will your lessons need cover?", "هل تحتاج حصصك إلى تغطية؟") },
              {
                id: "impact",
                type: "long_text",
                label: t("How will this benefit your students?", "كيف سيعود ذلك بالفائدة على طلبتك؟"),
                required: true,
                maxLength: 1500,
              },
            ],
          },
        ],
      },
    ],
  ),

  form(
    "staff_leave",
    "staff_operations",
    t("Leave request", "طلب إجازة"),
    t("Leave is granted in line with UAE labour law and the staff handbook.", "تُمنح الإجازات وفقًا لقانون العمل في الدولة ودليل الموظفين."),
    [
      {
        id: "leave",
        title: t("Leave details", "تفاصيل الإجازة"),
        sections: [
          {
            id: "leave_section",
            fields: [
              requesterName(),
              {
                id: "leaveType",
                type: "select",
                label: t("Type of leave", "نوع الإجازة"),
                required: true,
                options: [
                  o("annual", "Annual", "سنوية"),
                  o("sick", "Sick", "مرضية"),
                  o("compassionate", "Compassionate", "إجازة وفاة"),
                  o("maternity", "Maternity", "أمومة"),
                  o("hajj", "Hajj", "حج"),
                  o("study", "Study", "دراسية"),
                  o("unpaid", "Unpaid", "بدون راتب"),
                  o("other", "Other", "أخرى"),
                ],
              },
              { id: "startDate", type: "date", label: t("First day", "اليوم الأول"), required: true, width: "half" },
              { id: "endDate", type: "date", label: t("Last day", "اليوم الأخير"), required: true, width: "half" },
              { id: "daysRequested", type: "number", label: t("Working days requested", "عدد أيام العمل المطلوبة"), min: 1, max: 90 },
              {
                id: "medicalCertificate",
                type: "file",
                label: t("Medical certificate", "الشهادة الطبية"),
                required: true,
                showIf: { fieldId: "leaveType", op: "eq", value: "sick" },
              },
              {
                id: "coverPlan",
                type: "long_text",
                label: t("Cover plan for your lessons", "خطة تغطية حصصك"),
                maxLength: 1500,
              },
              { id: "signature", type: "signature", label: t("Signature", "التوقيع"), required: true },
            ],
          },
        ],
      },
    ],
  ),

  form(
    "maintenance_request",
    "staff_operations",
    t("Maintenance request", "طلب صيانة"),
    t("Report a fault and the facilities team will schedule a fix.", "أبلغ عن العطل وسيحدد فريق المرافق موعدًا لإصلاحه."),
    [
      {
        id: "fault",
        title: t("The fault", "العطل"),
        sections: [
          {
            id: "where_section",
            title: t("Location", "الموقع"),
            fields: [
              requesterName(),
              {
                id: "building",
                type: "select",
                label: t("Building", "المبنى"),
                required: true,
                width: "half",
                options: [
                  o("primary_block", "Primary block", "مبنى المرحلة الابتدائية"),
                  o("secondary_block", "Secondary block", "مبنى المرحلة الثانوية"),
                  o("sports_complex", "Sports complex", "المجمّع الرياضي"),
                  o("admin_building", "Administration", "المبنى الإداري"),
                  o("auditorium", "Auditorium", "المسرح"),
                ],
              },
              { id: "room", type: "short_text", label: t("Room", "الغرفة"), width: "half" },
            ],
          },
          {
            id: "issue_section",
            title: t("Issue", "المشكلة"),
            fields: [
              {
                id: "issueType",
                type: "select",
                label: t("Type of issue", "نوع المشكلة"),
                required: true,
                options: [
                  o("air_conditioning", "Air conditioning", "التكييف"),
                  o("electrical", "Electrical or lighting", "الكهرباء أو الإنارة"),
                  o("plumbing", "Plumbing", "السباكة"),
                  o("furniture", "Furniture", "الأثاث"),
                  o("doors_locks", "Doors and locks", "الأبواب والأقفال"),
                  o("cleaning", "Cleaning", "النظافة"),
                  o("other", "Other", "أخرى"),
                ],
              },
              { id: "description", type: "long_text", label: t("Description", "الوصف"), required: true, maxLength: 1500 },
              {
                id: "urgency",
                type: "radio",
                label: t("Urgency", "درجة الاستعجال"),
                required: true,
                options: [...URGENCY_OPTIONS, o("safety_hazard", "Safety hazard", "خطر على السلامة")],
              },
              {
                id: "hazardNotice",
                type: "statement",
                label: t(
                  "For safety hazards, also call the facilities desk on extension 200 and keep students away from the area.",
                  "في حال وجود خطر على السلامة، اتصل أيضًا بمكتب المرافق على الرقم الداخلي 200 وأبعد الطلبة عن المكان.",
                ),
                showIf: { fieldId: "urgency", op: "eq", value: "safety_hazard" },
              },
              { id: "photo", type: "file", label: t("Photo (optional)", "صورة (اختياري)") },
            ],
          },
        ],
      },
    ],
  ),
];
