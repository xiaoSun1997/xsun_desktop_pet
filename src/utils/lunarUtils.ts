// src/utils/lunarUtils.ts

/**
 * 中国农历转换工具类
 * 支持1900-2100年的公历农历转换
 */
export class LunarCalendar {
    // 农历数据表（1900-2100年）
    private static lunarInfo = [
        0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
        0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
        0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
        0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
        0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
        0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
        0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
        0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
        0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
        0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0,
        0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
        0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
        0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
        0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
        0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
        0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
        0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
        0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
        0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
        0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
        0x0d520
    ];

    // 节气数据
    private static solarTerms = [
        ["小寒", "大寒"], ["立春", "雨水"], ["惊蛰", "春分"],
        ["清明", "谷雨"], ["立夏", "小满"], ["芒种", "夏至"],
        ["小暑", "大暑"], ["立秋", "处暑"], ["白露", "秋分"],
        ["寒露", "霜降"], ["立冬", "小雪"], ["大雪", "冬至"]
    ];

    // 农历月份名称
    private static lunarMonths = [
        "", "正", "二", "三", "四", "五", "六",
        "七", "八", "九", "十", "冬", "腊"
    ];

    // 农历日期名称
    private static lunarDays = [
        "", "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
        "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
        "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"
    ];

    // 1900年1月31日为农历正月初一
    private static lunarBaseDate = new Date(1900, 0, 31);

    /**
     * 获取农历年份的天数
     */
    private static getLunarYearDays(year: number): number {
        let sum = 348;
        for (let i = 0x8000; i > 0x8; i >>= 1) {
            sum += (this.lunarInfo[year - 1900] & i) ? 1 : 0;
        }
        return sum + this.getLeapMonthDays(year);
    }

    /**
     * 获取农历年闰月天数
     */
    private static getLeapMonthDays(year: number): number {
        if (this.getLeapMonth(year)) {
            return (this.lunarInfo[year - 1900] & 0x10000) ? 30 : 29;
        }
        return 0;
    }

    /**
     * 获取农历年闰哪个月
     */
    private static getLeapMonth(year: number): number {
        return this.lunarInfo[year - 1900] & 0xf;
    }

    /**
     * 获取农历年月天数
     */
    private static getLunarMonthDays(year: number, month: number): number {
        return (this.lunarInfo[year - 1900] & (0x10000 >> month)) ? 30 : 29;
    }

    /**
     * 转换为农历
     */
    static toLunar(date: Date): { year: number, month: number, day: number, monthName: string, dayName: string, isLeap: boolean } {
        const year = date.getFullYear();
        const month = date.getMonth();
        const day = date.getDate();

        let offset = Math.floor((date.getTime() - this.lunarBaseDate.getTime()) / 86400000);

        let lunarYear = 1900;
        let daysInYear = 0;

        // 计算农历年份
        while (lunarYear < 2100 && offset > 0) {
            daysInYear = this.getLunarYearDays(lunarYear);
            if (offset < daysInYear) break;
            offset -= daysInYear;
            lunarYear++;
        }

        // 计算农历月份
        let lunarMonth = 1;
        let isLeap = false;
        const leapMonth = this.getLeapMonth(lunarYear);

        while (lunarMonth <= 12 && offset > 0) {
            // 闰月
            if (leapMonth > 0 && lunarMonth === (leapMonth + 1) && !isLeap) {
                lunarMonth--;
                isLeap = true;
                daysInYear = this.getLeapMonthDays(lunarYear);
            } else {
                daysInYear = this.getLunarMonthDays(lunarYear, lunarMonth);
            }

            if (offset < daysInYear) break;
            offset -= daysInYear;

            if (isLeap && lunarMonth === (leapMonth + 1)) {
                isLeap = false;
            }
            lunarMonth++;
        }

        const lunarDay = offset + 1;
        const monthName = this.lunarMonths[lunarMonth] || lunarMonth.toString();
        const dayName = this.lunarDays[lunarDay] || lunarDay.toString();

        return {
            year: lunarYear,
            month: lunarMonth,
            day: lunarDay,
            monthName,
            dayName,
            isLeap
        };
    }

    /**
     * 获取节气
     */
    static getSolarTerm(date: Date): string | null {
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();

        // 简化的节气计算 - 基于固定日期范围
        const solarTermDates: { [key: string]: string } = {
            '1-5': '小寒', '1-6': '小寒', '1-20': '大寒', '1-21': '大寒',
            '2-3': '立春', '2-4': '立春', '2-18': '雨水', '2-19': '雨水',
            '3-5': '惊蛰', '3-6': '惊蛰', '3-20': '春分', '3-21': '春分',
            '4-4': '清明', '4-5': '清明', '4-19': '谷雨', '4-20': '谷雨',
            '5-5': '立夏', '5-6': '立夏', '5-20': '小满', '5-21': '小满',
            '6-5': '芒种', '6-6': '芒种', '6-21': '夏至', '6-22': '夏至',
            '7-6': '小暑', '7-7': '小暑', '7-22': '大暑', '7-23': '大暑',
            '8-7': '立秋', '8-8': '立秋', '8-22': '处暑', '8-23': '处暑',
            '9-7': '白露', '9-8': '白露', '9-22': '秋分', '9-23': '秋分',
            '10-8': '寒露', '10-9': '寒露', '10-23': '霜降', '10-24': '霜降',
            '11-7': '立冬', '11-8': '立冬', '11-22': '小雪', '11-23': '小雪',
            '12-6': '大雪', '12-7': '大雪', '12-21': '冬至', '12-22': '冬至'
        };

        const key = `${month}-${day}`;
        return solarTermDates[key] || null;
    }

    /**
     * 格式化农历日期显示
     */
    static formatLunarDate(date: Date): string {
        const lunar = this.toLunar(date);
        const prefix = lunar.isLeap ? '闰' : '';
        return `${prefix}${lunar.monthName}月${lunar.dayName}`;
    }
}
