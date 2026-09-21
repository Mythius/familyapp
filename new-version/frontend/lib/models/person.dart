class Person {
  Person({
    required this.id,
    required this.familyId,
    this.name,
    this.gender,
    this.address,
    this.phone,
    this.email,
    this.generation,
    this.birthday,
    this.motherId,
    this.fatherId,
    this.spouseId,
    this.marriageDate,
    this.deathDate,
    this.maidenName,
    this.photo,
    this.notes,
    this.order,
    this.facebook,
    this.instagram,
    this.flag1,
    this.flag2,
    this.fatherName,
    this.motherName,
    this.spouseNames,
    this.childrenNames,
  });

  final int id;
  final String familyId;
  final String? name;
  final String? gender;
  final String? address;
  final String? phone;
  final String? email;
  final String? generation;
  final DateTime? birthday;
  final int? motherId;
  final int? fatherId;
  final int? spouseId;
  final DateTime? marriageDate;
  final DateTime? deathDate;
  final String? maidenName;
  final String? photo;
  final String? notes;
  final String? order;
  final String? facebook;
  final String? instagram;
  final String? flag1;
  final String? flag2;

  // Only present on the /people/:name detail response.
  final String? fatherName;
  final String? motherName;
  final String? spouseNames;
  final String? childrenNames;

  static DateTime? _date(dynamic v) =>
      v == null ? null : DateTime.tryParse(v as String);

  factory Person.fromJson(Map<String, dynamic> json) => Person(
        id: json['id'] as int,
        familyId: json['familyId'] as String,
        name: json['name'] as String?,
        gender: json['gender'] as String?,
        address: json['address'] as String?,
        phone: json['phone'] as String?,
        email: json['email'] as String?,
        generation: json['generation'] as String?,
        birthday: _date(json['birthday']),
        motherId: json['motherId'] as int?,
        fatherId: json['fatherId'] as int?,
        spouseId: json['spouseId'] as int?,
        marriageDate: _date(json['marriageDate']),
        deathDate: _date(json['deathDate']),
        maidenName: json['maidenName'] as String?,
        photo: json['photo'] as String?,
        notes: json['notes'] as String?,
        order: json['order'] as String?,
        facebook: json['facebook'] as String?,
        instagram: json['instagram'] as String?,
        flag1: json['flag1'] as String?,
        flag2: json['flag2'] as String?,
        fatherName: json['father_name'] as String?,
        motherName: json['mother_name'] as String?,
        spouseNames: json['spouse_names'] as String?,
        childrenNames: json['children_names'] as String?,
      );
}
