import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../core/api_client.dart';
import '../models/person.dart';

const _weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/// Month-grid view, ported from the prototype's `populateCalendarMonth()`
/// (main.js): a birthday recurs every year, so this cycles a bare 0–11 month
/// index rather than a real year — matching a person's birthday to "this
/// month, this day of month" regardless of which year is displayed. Death
/// date is deliberately not filtered out here, matching the prototype: a
/// birthday is still shown for someone who has since passed away.
class CalendarScreen extends StatefulWidget {
  const CalendarScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<CalendarScreen> createState() => _CalendarScreenState();
}

class _CalendarScreenState extends State<CalendarScreen> {
  List<Person>? _people;
  String? _error;
  late int _month = DateTime.now().month - 1; // 0-based, like the prototype's `month`

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await widget.api.get('/people') as List;
      setState(() => _people = data.cast<Map<String, dynamic>>().map(Person.fromJson).toList());
    } catch (e) {
      setState(() => _error = e.toString());
    }
  }

  void _prevMonth() => setState(() => _month = (_month - 1 + 12) % 12);
  void _nextMonth() => setState(() => _month = (_month + 1 + 12) % 12);
  void _today() => setState(() => _month = DateTime.now().month - 1);

  Map<int, List<Person>> _birthdaysByDay() {
    final map = <int, List<Person>>{};
    for (final p in _people!) {
      final bday = p.birthday;
      if (bday == null || bday.month - 1 != _month) continue;
      map.putIfAbsent(bday.day, () => []).add(p);
    }
    for (final list in map.values) {
      list.sort((a, b) => (a.name ?? '').compareTo(b.name ?? ''));
    }
    return map;
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) return Center(child: Text(_error!));
    if (_people == null) return const Center(child: CircularProgressIndicator());

    final now = DateTime.now();
    final year = now.year;
    final firstOfMonth = DateTime(year, _month + 1, 1);
    final daysInMonth = DateTime(year, _month + 2, 0).day;
    final startWeekday = firstOfMonth.weekday % 7; // Dart Mon=1..Sun=7 -> Sun=0..Sat=6
    final byDay = _birthdaysByDay();
    final isCurrentMonth = _month == now.month - 1;

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              IconButton(onPressed: _prevMonth, icon: const Icon(Icons.chevron_left)),
              SizedBox(
                width: 160,
                child: Text(
                  DateFormat('MMMM').format(firstOfMonth),
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
              IconButton(onPressed: _nextMonth, icon: const Icon(Icons.chevron_right)),
              if (!isCurrentMonth) ...[
                const SizedBox(width: 8),
                TextButton(onPressed: _today, child: const Text('Today')),
              ],
            ],
          ),
        ),
        Row(
          children: _weekdayLabels
              .map((d) => Expanded(
                    child: Center(
                      child: Text(d, style: Theme.of(context).textTheme.labelMedium),
                    ),
                  ))
              .toList(),
        ),
        const Divider(height: 1),
        Expanded(
          child: _MonthGrid(
            daysInMonth: daysInMonth,
            startWeekday: startWeekday,
            byDay: byDay,
            today: isCurrentMonth ? now.day : null,
            onTapPerson: (p) => context.go('/person/${Uri.encodeComponent(p.name ?? '')}'),
          ),
        ),
      ],
    );
  }
}

class _MonthGrid extends StatelessWidget {
  const _MonthGrid({
    required this.daysInMonth,
    required this.startWeekday,
    required this.byDay,
    required this.today,
    required this.onTapPerson,
  });

  final int daysInMonth;
  final int startWeekday;
  final Map<int, List<Person>> byDay;
  final int? today;
  final void Function(Person) onTapPerson;

  @override
  Widget build(BuildContext context) {
    final rows = ((startWeekday + daysInMonth) / 7).ceil();

    return Column(
      children: List.generate(rows, (row) {
        return Expanded(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: List.generate(7, (col) {
              final day = row * 7 + col - startWeekday + 1;
              final valid = day >= 1 && day <= daysInMonth;
              return Expanded(
                child: _DayCell(
                  day: valid ? day : null,
                  isToday: valid && day == today,
                  people: valid ? (byDay[day] ?? const []) : const [],
                  onTapPerson: onTapPerson,
                ),
              );
            }),
          ),
        );
      }),
    );
  }
}

class _DayCell extends StatelessWidget {
  const _DayCell({
    required this.day,
    required this.isToday,
    required this.people,
    required this.onTapPerson,
  });

  final int? day;
  final bool isToday;
  final List<Person> people;
  final void Function(Person) onTapPerson;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: Theme.of(context).dividerColor, width: 0.5),
        color: isToday ? scheme.primaryContainer.withValues(alpha: 0.3) : null,
      ),
      padding: const EdgeInsets.all(4),
      child: day == null
          ? const SizedBox.shrink()
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '$day',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        fontWeight: isToday ? FontWeight.bold : null,
                        color: isToday ? scheme.primary : null,
                      ),
                ),
                if (people.isNotEmpty)
                  Expanded(
                    child: SingleChildScrollView(
                      child: Wrap(
                        spacing: 2,
                        runSpacing: 2,
                        children: people
                            .map((p) => _BirthdayChip(person: p, onTap: () => onTapPerson(p)))
                            .toList(),
                      ),
                    ),
                  ),
              ],
            ),
    );
  }
}

class _BirthdayChip extends StatelessWidget {
  const _BirthdayChip({required this.person, required this.onTap});
  final Person person;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final deceased = person.deathDate != null;
    return GestureDetector(
      onTap: onTap,
      child: MouseRegion(
        cursor: SystemMouseCursors.click,
        child: Container(
          constraints: const BoxConstraints(maxWidth: 110),
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
          decoration: BoxDecoration(
            color: deceased ? scheme.surfaceContainerHighest : scheme.primaryContainer,
            borderRadius: BorderRadius.circular(4),
          ),
          child: Text(
            person.name ?? '?',
            style: TextStyle(
              fontSize: 10,
              color: deceased ? scheme.onSurfaceVariant : scheme.onPrimaryContainer,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ),
    );
  }
}
