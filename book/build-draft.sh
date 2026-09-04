#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "$0")"

output="DRAFT.md"
temporary="${output}.tmp"

chapters=(
  "01-expressions.md"
  "02-primitive-types.md"
  "03-functions.md"
  "04-operators.md"
  "05-layout.md"
  "06-polymorphism.md"
  "07-tuples.md"
  "08-type-aliases.md"
  "09-records.md"
  "10-unions.md"
  "11-patterns.md"
  "12-constraints.md"
  "13-derivation.md"
  "14-modules.md"
  "15-dot-calls.md"
  "16-mutable-variables.md"
  "17-loops-and-ranges.md"
  "18-sequences.md"
  "19-effects.md"
  "20-streams.md"
  "21-exceptions.md"
  "22-collections.md"
  "23-implied-types.md"
  "24-javascript-output.md"
  "25-typescript-output.md"
  "26-javascript-input.md"
  "27-constraints-in-javascript.md"
  "28-packages.md"
)

chapter_titles=(
  "Expressions"
  "Primitive Types"
  "Functions"
  "Operators"
  "Layout"
  "Polymorphism"
  "Tuples"
  "Type Aliases"
  "Records"
  "Unions"
  "Patterns"
  "Constraints"
  "Derivation"
  "Modules"
  "Dot Calls"
  "Mutable Variables"
  "Loops and Ranges"
  "Sequences"
  "Effects"
  "Streams"
  "Exceptions"
  "Collections"
  "Implied Types"
  "JavaScript Output"
  "TypeScript Output"
  "JavaScript Input"
  "Constraints in JavaScript"
  "Packages"
)

part_for_chapter() {
  case "$1" in
    1) echo "Part I — Values and Functions" ;;
    7) echo "Part II — Data" ;;
    12) echo "Part III — Capabilities and Modules" ;;
    16) echo "Part IV — State and Flow" ;;
    22) echo "Part V — Collections and Implied Types" ;;
    24) echo "Part VI — JavaScript and TypeScript" ;;
    28) echo "Part VII — Programs" ;;
  esac
}

{
  sed -n '1,$p' FRONTMATTER.md

  echo
  echo '<div style="page-break-after: always;"></div>'
  echo
  echo '# Contents'
  echo
  echo '## Part I — Values and Functions'
  echo
  echo '1. [Expressions](#chapter-1)'
  echo '2. [Primitive Types](#chapter-2)'
  echo '3. [Functions](#chapter-3)'
  echo '4. [Operators](#chapter-4)'
  echo '5. [Layout](#chapter-5)'
  echo '6. [Polymorphism](#chapter-6)'
  echo
  echo '## Part II — Data'
  echo
  echo '7. [Tuples](#chapter-7)'
  echo '8. [Type Aliases](#chapter-8)'
  echo '9. [Records](#chapter-9)'
  echo '10. [Unions](#chapter-10)'
  echo '11. [Patterns](#chapter-11)'
  echo
  echo '## Part III — Capabilities and Modules'
  echo
  echo '12. [Constraints](#chapter-12)'
  echo '13. [Derivation](#chapter-13)'
  echo '14. [Modules](#chapter-14)'
  echo '15. [Dot Calls](#chapter-15)'
  echo
  echo '## Part IV — State and Flow'
  echo
  echo '16. [Mutable Variables](#chapter-16)'
  echo '17. [Loops and Ranges](#chapter-17)'
  echo '18. [Sequences](#chapter-18)'
  echo '19. [Effects](#chapter-19)'
  echo '20. [Streams](#chapter-20)'
  echo '21. [Exceptions](#chapter-21)'
  echo
  echo '## Part V — Collections and Implied Types'
  echo
  echo '22. [Collections](#chapter-22)'
  echo '23. [Implied Types](#chapter-23)'
  echo
  echo '## Part VI — JavaScript and TypeScript'
  echo
  echo '24. [JavaScript Output](#chapter-24)'
  echo '25. [TypeScript Output](#chapter-25)'
  echo '26. [JavaScript Input](#chapter-26)'
  echo '27. [Constraints in JavaScript](#chapter-27)'
  echo
  echo '## Part VII — Programs'
  echo
  echo '28. [Packages](#chapter-28)'

  for index in "${!chapters[@]}"; do
    number=$((index + 1))
    part="$(part_for_chapter "$number")"

    echo
    echo '<div style="page-break-after: always;"></div>'
    echo

    if [[ -n "$part" ]]; then
      echo "# $part"
      echo
    fi

    echo "<a id=\"chapter-$number\"></a>"
    echo
    echo "# $number. ${chapter_titles[$index]}"
    echo
    sed '1d' "chapters/${chapters[$index]}"
  done
} > "$temporary"

mv "$temporary" "$output"

echo "Built $output"
