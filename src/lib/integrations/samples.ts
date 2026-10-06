// Sample export files for trying scheduled sync: the Import center templates, and a students file in the
// layout a typical student information system exports (other header names), which needs a column mapping.
// All people are fictional and use reserved example domains. Pure.
import { templateCsv as studentsTemplateCsv } from "@/lib/people-csv";
import { staffTemplateCsv } from "@/lib/imports/staff";
import { classesTemplateCsv, enrollmentsTemplateCsv } from "@/lib/imports/classes";
import { csvLine } from "@/lib/imports/headers";

/** The SIS-layout students file and the mapping that reads it. */
export const SIS_STUDENTS_HEADERS = ["Pupil ID", "Legal Forename", "Legal Surname", "Forename (Arabic)", "Surname (Arabic)", "NC Year", "Reg Group", "DOB", "Contact 1 Forename", "Contact 1 Surname", "Contact 1 Email", "Contact 1 Mobile", "Contact 1 Relationship"];
export const SIS_STUDENTS_MAPPING: Record<string, string> = {
  "pupil id": "student_no",
  "legal forename": "first_name_en",
  "legal surname": "last_name_en",
  "forename arabic": "first_name_ar",
  "surname arabic": "last_name_ar",
  "nc year": "grade",
  "reg group": "section",
  dob: "date_of_birth",
  "contact 1 forename": "guardian_first_name_en",
  "contact 1 surname": "guardian_last_name_en",
  "contact 1 email": "guardian_email",
  "contact 1 mobile": "guardian_phone",
  "contact 1 relationship": "relationship",
};

const SIS_ROWS = [
  ["SIS-24001", "Yara", "Khoury", "يارا", "خوري", "9", "C", "2011-05-14", "Rami", "Khoury", "rami.khoury@family.example", "+971 50 000 1101", "father"],
  ["SIS-24002", "Hamdan", "Al Ketbi", "حمدان", "الكتبي", "9", "C", "2011-09-02", "Mouza", "Al Ketbi", "mouza.alketbi@family.example", "+971 50 000 1102", "mother"],
  ["SIS-24003", "Zain", "Farouk", "زين", "فاروق", "10", "B", "2010-12-21", "Huda", "Farouk", "huda.farouk@family.example", "+971 50 000 1103", "mother"],
];

export const SAMPLE_FILES: Record<string, () => string> = {
  "students.csv": studentsTemplateCsv,
  "staff.csv": staffTemplateCsv,
  "classes.csv": classesTemplateCsv,
  "enrollments.csv": enrollmentsTemplateCsv,
  "sis-students.csv": () => `${[csvLine(SIS_STUDENTS_HEADERS), ...SIS_ROWS.map(csvLine)].join("\n")}\n`,
};
