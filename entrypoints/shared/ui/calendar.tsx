import { DayPicker, type DayPickerProps } from "react-day-picker";
import { zhCN } from "react-day-picker/locale";
import "./calendar.css";

export function Calendar({ className = "", ...props }: DayPickerProps) {
  return (
    <DayPicker
      locale={zhCN}
      weekStartsOn={0}
      showOutsideDays
      fixedWeeks
      numberOfMonths={1}
      className={`oj-calendar ${className}`.trim()}
      formatters={{
        formatCaption: (date) =>
          `${date.getFullYear()}年${date.getMonth() + 1}月`,
        formatWeekdayName: (date) =>
          ["日", "一", "二", "三", "四", "五", "六"][date.getDay()]!,
      }}
      labels={{
        labelPrevious: () => "上个月",
        labelNext: () => "下个月",
      }}
      {...props}
    />
  );
}
