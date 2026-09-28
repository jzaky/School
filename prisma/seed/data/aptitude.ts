// Aptitude assessment statements (5-point Likert, "strongly disagree" to "strongly agree").
// Five statements per dimension, interleaved so students never see a block on one theme.
// Items marked reverse: true are scored in the opposite direction.
import type { AptitudeQuestionSeed } from "@/server/career/dimensions";

export const APTITUDE_QUESTIONS: AptitudeQuestionSeed[] = [
  // Round 1
  {
    dimension: "analytical",
    text: {
      en: "I enjoy solving puzzles that have one correct answer.",
      ar: "أستمتع بحل الألغاز التي لها إجابة صحيحة واحدة.",
    },
  },
  {
    dimension: "verbal",
    text: {
      en: "I can explain my ideas clearly when I write or speak.",
      ar: "أستطيع أن أشرح أفكاري بوضوح عندما أكتب أو أتحدث.",
    },
  },
  {
    dimension: "spatial",
    text: {
      en: "I can easily picture how an object would look from a different angle.",
      ar: "أستطيع بسهولة أن أتخيّل شكل الجسم إذا نظرت إليه من زاوية مختلفة.",
    },
  },
  {
    dimension: "investigative",
    text: {
      en: "I often ask why things happen the way they do.",
      ar: "كثيرًا ما أتساءل عن سبب حدوث الأشياء بالطريقة التي تحدث بها.",
    },
  },
  {
    dimension: "creative",
    text: {
      en: "I like coming up with original ideas that nobody else has thought of.",
      ar: "أحب أن أبتكر أفكارًا أصيلة لم تخطر ببال أحد غيري.",
    },
  },
  {
    dimension: "social",
    text: {
      en: "Friends often come to me when they need help or advice.",
      ar: "يلجأ إليّ أصدقائي كثيرًا عندما يحتاجون إلى المساعدة أو النصيحة.",
    },
  },
  {
    dimension: "enterprising",
    text: {
      en: "I like taking the lead when my group is working on a project.",
      ar: "أحب أن أتولى القيادة عندما تعمل مجموعتي على مشروع ما.",
    },
  },
  {
    dimension: "technical",
    text: {
      en: "I enjoy figuring out how machines or devices work by taking them apart.",
      ar: "أستمتع باكتشاف طريقة عمل الآلات أو الأجهزة من خلال تفكيكها.",
    },
  },
  {
    dimension: "organized",
    text: {
      en: "I plan my homework and revision so that I finish before deadlines.",
      ar: "أنظّم واجباتي ومراجعتي بحيث أنتهي منها قبل المواعيد النهائية.",
    },
  },

  // Round 2
  {
    dimension: "analytical",
    text: {
      en: "I like working with numbers, patterns and formulas.",
      ar: "أحب التعامل مع الأرقام والأنماط والمعادلات.",
    },
  },
  {
    dimension: "verbal",
    text: {
      en: "I enjoy reading books, articles or stories in my free time.",
      ar: "أستمتع بقراءة الكتب أو المقالات أو القصص في وقت فراغي.",
    },
  },
  {
    dimension: "spatial",
    text: {
      en: "I find maps, diagrams and charts easy to understand.",
      ar: "أجد الخرائط والرسوم التوضيحية والمخططات سهلة الفهم.",
    },
  },
  {
    dimension: "investigative",
    text: {
      en: "I enjoy doing experiments to test whether an idea is true.",
      ar: "أستمتع بإجراء التجارب لأتحقق من صحة فكرة ما.",
    },
  },
  {
    dimension: "creative",
    text: {
      en: "I enjoy drawing, designing, writing stories or making music.",
      ar: "أستمتع بالرسم أو التصميم أو كتابة القصص أو تأليف الموسيقى.",
    },
  },
  {
    dimension: "social",
    text: {
      en: "I prefer to work on my own rather than spend time helping others with their problems.",
      ar: "أفضّل العمل بمفردي على قضاء الوقت في مساعدة الآخرين في حل مشكلاتهم.",
    },
    reverse: true,
  },
  {
    dimension: "enterprising",
    text: {
      en: "I enjoy persuading people to support my ideas.",
      ar: "أستمتع بإقناع الآخرين بتأييد أفكاري.",
    },
  },
  {
    dimension: "technical",
    text: {
      en: "I like building, fixing or assembling things with my hands.",
      ar: "أحب البناء أو التصليح أو التركيب بيديّ.",
    },
  },
  {
    dimension: "organized",
    text: {
      en: "I check my work carefully for small mistakes before handing it in.",
      ar: "أراجع عملي بعناية بحثًا عن الأخطاء الصغيرة قبل تسليمه.",
    },
  },

  // Round 3
  {
    dimension: "analytical",
    text: {
      en: "I find working with numbers boring.",
      ar: "أجد التعامل مع الأرقام مملًّا.",
    },
    reverse: true,
  },
  {
    dimension: "verbal",
    text: {
      en: "I enjoy debating and discussing different points of view.",
      ar: "أستمتع بالمناظرة ومناقشة وجهات النظر المختلفة.",
    },
  },
  {
    dimension: "spatial",
    text: {
      en: "I am good at arranging furniture or objects so that they fit well in a space.",
      ar: "أجيد ترتيب الأثاث أو الأغراض بحيث تتناسب جيدًا مع المساحة المتاحة.",
    },
  },
  {
    dimension: "investigative",
    text: {
      en: "I like researching a topic deeply until I really understand it.",
      ar: "أحب البحث في الموضوع بعمق حتى أفهمه فهمًا حقيقيًا.",
    },
  },
  {
    dimension: "creative",
    text: {
      en: "When I have a task, I like to find my own way of doing it rather than following an example.",
      ar: "عندما تُسند إليّ مهمة، أحب أن أنجزها بطريقتي الخاصة بدل أن أتبع نموذجًا جاهزًا.",
    },
  },
  {
    dimension: "social",
    text: {
      en: "I enjoy explaining things to classmates who are finding a topic difficult.",
      ar: "أستمتع بشرح الدروس لزملائي الذين يجدون صعوبة في فهم موضوع ما.",
    },
  },
  {
    dimension: "enterprising",
    text: {
      en: "I have thought about starting my own business or project one day.",
      ar: "فكّرت في أن أبدأ مشروعي أو عملي الخاص يومًا ما.",
    },
  },
  {
    dimension: "technical",
    text: {
      en: "I enjoy using tools, equipment or software to make something work.",
      ar: "أستمتع باستخدام الأدوات أو المعدات أو البرامج لجعل شيء ما يعمل.",
    },
  },
  {
    dimension: "organized",
    text: {
      en: "My desk, files and school bag are usually messy.",
      ar: "غالبًا ما تكون طاولتي وملفاتي وحقيبتي المدرسية غير مرتبة.",
    },
    reverse: true,
  },

  // Round 4
  {
    dimension: "analytical",
    text: {
      en: "I like breaking a big problem into smaller logical steps.",
      ar: "أحب تقسيم المشكلة الكبيرة إلى خطوات منطقية أصغر.",
    },
  },
  {
    dimension: "verbal",
    text: {
      en: "I enjoy learning new languages or new words.",
      ar: "أستمتع بتعلّم لغات جديدة أو مفردات جديدة.",
    },
  },
  {
    dimension: "spatial",
    text: {
      en: "I enjoy activities like building models, 3D design or construction games.",
      ar: "أستمتع بأنشطة مثل بناء المجسّمات أو التصميم ثلاثي الأبعاد أو ألعاب البناء.",
    },
  },
  {
    dimension: "investigative",
    text: {
      en: "I like watching documentaries or reading about science and discoveries.",
      ar: "أحب مشاهدة الأفلام الوثائقية أو القراءة عن العلوم والاكتشافات.",
    },
  },
  {
    dimension: "creative",
    text: {
      en: "I notice colours, shapes and styles that other people often miss.",
      ar: "ألاحظ الألوان والأشكال والأساليب التي كثيرًا ما تفوت الآخرين.",
    },
  },
  {
    dimension: "social",
    text: {
      en: "I can usually tell how someone is feeling even if they do not say it.",
      ar: "أستطيع في العادة أن أدرك مشاعر الشخص حتى لو لم يُفصح عنها.",
    },
  },
  {
    dimension: "enterprising",
    text: {
      en: "I feel confident speaking in front of a group or presenting to the class.",
      ar: "أشعر بالثقة عند التحدث أمام مجموعة أو تقديم عرض أمام الصف.",
    },
  },
  {
    dimension: "technical",
    text: {
      en: "I prefer practical lessons in the lab or workshop to lessons that are only theory.",
      ar: "أفضّل الدروس العملية في المختبر أو الورشة على الدروس النظرية فقط.",
    },
  },
  {
    dimension: "organized",
    text: {
      en: "I like to follow a clear plan or checklist when I work.",
      ar: "أحب أن أتبع خطة واضحة أو قائمة مهام عندما أعمل.",
    },
  },

  // Round 5
  {
    dimension: "analytical",
    text: {
      en: "I enjoy games of strategy such as chess or logic puzzles.",
      ar: "أستمتع بألعاب الاستراتيجية مثل الشطرنج أو ألغاز المنطق.",
    },
  },
  {
    dimension: "verbal",
    text: {
      en: "People say I am a good writer or a good speaker.",
      ar: "يقول لي الآخرون إنني أجيد الكتابة أو التحدث.",
    },
  },
  {
    dimension: "spatial",
    text: {
      en: "I rarely get lost because I remember routes and places well.",
      ar: "نادرًا ما أضلّ طريقي لأنني أتذكر الطرق والأماكن جيدًا.",
    },
  },
  {
    dimension: "investigative",
    text: {
      en: "When I get a surprising result, I want to find out what caused it.",
      ar: "عندما أحصل على نتيجة غير متوقعة، أرغب في معرفة سببها.",
    },
  },
  {
    dimension: "creative",
    text: {
      en: "I enjoy imagining new inventions or better ways of doing everyday things.",
      ar: "أستمتع بتخيّل اختراعات جديدة أو طرق أفضل لإنجاز الأمور اليومية.",
    },
  },
  {
    dimension: "social",
    text: {
      en: "I would enjoy a job where I support people to feel better or learn something new.",
      ar: "سأستمتع بعمل أساعد فيه الناس على أن يشعروا بتحسّن أو يتعلّموا شيئًا جديدًا.",
    },
  },
  {
    dimension: "enterprising",
    text: {
      en: "I like setting ambitious goals and competing to reach them.",
      ar: "أحب أن أضع لنفسي أهدافًا طموحة وأنافس لتحقيقها.",
    },
  },
  {
    dimension: "technical",
    text: {
      en: "I am the person my family asks when a device or gadget stops working.",
      ar: "أنا من تلجأ إليه أسرتي عندما يتعطل جهاز ما.",
    },
  },
  {
    dimension: "organized",
    text: {
      en: "I keep track of my tasks and appointments in a planner or app.",
      ar: "أتابع مهامي ومواعيدي من خلال مفكرة أو تطبيق للتنظيم.",
    },
  },
];
